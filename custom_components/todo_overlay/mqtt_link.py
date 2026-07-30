"""MQTT transport for linked-list sync - see link_sync.py for the actual
conflict-resolution/sync logic this feeds. Deliberately kept as a thin,
swappable layer (the LinkTransport protocol below, with PahoMqttTransport
as the real implementation) so link_sync.py can be unit tested against a
fake transport with no real networking or broker involved - only the
plumbing here (connect/reconnect/TLS/subscribe dispatch) needs a real
broker to verify, which is covered separately against a real local
Mosquitto instance.

One PahoMqttTransport instance is shared by every link this HA instance
participates in - a single connection to the one configured broker,
subscribed to each active link's own topic filter.
"""

from __future__ import annotations

import logging
import ssl
from collections.abc import Callable
from typing import Protocol

import paho.mqtt.client as mqtt

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

MessageHandler = Callable[[str, bytes], None]

# Every link's topics live under this prefix - see link_sync.py for the
# exact per-link topic shapes (state snapshot vs. per-item diff).
TOPIC_PREFIX = "todo_overlay/link"


class LinkTransport(Protocol):
    """What link_sync.py needs from a broker connection - nothing more."""

    async def async_connect(self) -> None:
        """Connect (and keep reconnecting) to the broker."""

    async def async_disconnect(self) -> None:
        """Disconnect and stop reconnecting."""

    async def async_publish(
        self, topic: str, payload: bytes, *, retain: bool = False, qos: int = 1,
    ) -> None:
        """Publish a message."""

    def subscribe(self, topic_filter: str, handler: MessageHandler) -> None:
        """Register a handler for a topic filter (subscribed now if
        already connected, and again on every future reconnect)."""

    def unsubscribe(self, topic_filter: str) -> None:
        """Stop receiving and forget a previously-subscribed filter."""


class PahoMqttTransport:
    """Real transport, backed by paho-mqtt's own threaded network loop.

    paho's loop_start() runs socket I/O on its own background thread, so
    every callback it invokes (on_connect/on_message/...) runs off the
    HA event loop - handler dispatch is bounced back onto it via
    hass.loop.call_soon_threadsafe rather than called directly.
    """

    def __init__(
        self,
        hass: HomeAssistant,
        *,
        host: str,
        port: int,
        username: str | None,
        password: str | None,
        use_tls: bool,
        client_id: str,
        transport: str = "tcp",
        ws_path: str = "/mqtt",
    ) -> None:
        self._hass = hass
        self._host = host
        self._port = port
        self._subscribed_filters: set[str] = set()

        self._client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=client_id,
            protocol=mqtt.MQTTv5,
            transport=transport,
        )

        if transport == "websockets":
            self._client.ws_set_options(path=ws_path)

        if username:
            self._client.username_pw_set(username, password)

        if use_tls:
            self._client.tls_set(cert_reqs=ssl.CERT_REQUIRED)

        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect

    def _on_connect(self, client, userdata, connect_flags, reason_code, properties) -> None:
        if reason_code != 0:
            _LOGGER.error("MQTT link connect to %s:%s failed: %s", self._host, self._port, reason_code)
            return

        _LOGGER.debug("MQTT link connected to %s:%s", self._host, self._port)

        # Subscriptions don't survive a reconnect on their own - redo
        # every filter a link has registered so far.
        for topic_filter in self._subscribed_filters:
            client.subscribe(topic_filter, qos=1)

    def _on_disconnect(self, client, userdata, disconnect_flags, reason_code, properties) -> None:
        if reason_code != 0:
            _LOGGER.warning("MQTT link to %s:%s disconnected unexpectedly: %s", self._host, self._port, reason_code)

    async def async_connect(self) -> None:
        await self._hass.async_add_executor_job(self._client.connect, self._host, self._port, 60)
        self._client.loop_start()

    async def async_disconnect(self) -> None:
        await self._hass.async_add_executor_job(self._client.loop_stop)
        await self._hass.async_add_executor_job(self._client.disconnect)

    async def async_publish(
        self, topic: str, payload: bytes, *, retain: bool = False, qos: int = 1,
    ) -> None:
        await self._hass.async_add_executor_job(
            lambda: self._client.publish(topic, payload, qos=qos, retain=retain)
        )

    def subscribe(self, topic_filter: str, handler: MessageHandler) -> None:
        def _wrapped(client, userdata, message) -> None:
            self._hass.loop.call_soon_threadsafe(handler, message.topic, message.payload)

        self._client.message_callback_add(topic_filter, _wrapped)
        self._subscribed_filters.add(topic_filter)

        if self._client.is_connected():
            self._client.subscribe(topic_filter, qos=1)

    def unsubscribe(self, topic_filter: str) -> None:
        self._subscribed_filters.discard(topic_filter)
        self._client.message_callback_remove(topic_filter)

        if self._client.is_connected():
            self._client.unsubscribe(topic_filter)
