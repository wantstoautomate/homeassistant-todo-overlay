"""Construction-only tests for PahoMqttTransport's transport/websocket
wiring - no real networking (that's covered separately against a real
local Mosquitto instance, both plain and websocket listeners, since
that's the only way to genuinely prove a live handshake/ACL/TLS work,
not something worth faking here)."""

import asyncio

from custom_components.todo_overlay.mqtt_link import PahoMqttTransport


class FakeHass:

    async def async_add_executor_job(self, func, *args):
        return func(*args)


def test_defaults_to_plain_tcp_transport():
    transport = PahoMqttTransport(
        FakeHass(), host="localhost", port=1883,
        username=None, password=None, use_tls=False, client_id="test",
    )

    assert transport._client.transport == "tcp"


def test_websockets_transport_sets_the_configured_path():
    transport = PahoMqttTransport(
        FakeHass(), host="localhost", port=443,
        username=None, password=None, use_tls=True, client_id="test",
        transport="websockets", ws_path="/mqtt",
    )

    assert transport._client.transport == "websockets"
    assert transport._client._websocket_path == "/mqtt"


def test_websockets_transport_with_a_custom_path():
    transport = PahoMqttTransport(
        FakeHass(), host="localhost", port=443,
        username=None, password=None, use_tls=True, client_id="test",
        transport="websockets", ws_path="/custom-mqtt-path",
    )

    assert transport._client._websocket_path == "/custom-mqtt-path"


def test_tls_set_is_deferred_to_async_connect_not_construction():
    """tls_set() loads the system's default CA certs from disk - a
    genuinely blocking filesystem operation HA's own blocking-call
    detector flags if it runs directly on the event loop, which
    __init__ (not async) has no way to avoid on its own - confirmed
    live: "Detected blocking call to load_default_certs ... inside the
    event loop"."""

    transport = PahoMqttTransport(
        FakeHass(), host="localhost", port=8883,
        username=None, password=None, use_tls=True, client_id="test",
    )

    assert transport._client._ssl_context is None

    transport._client.connect = lambda *a, **k: None  # avoid a real network attempt

    asyncio.run(transport.async_connect())

    assert transport._client._ssl_context is not None


def test_no_tls_set_at_all_when_use_tls_is_false():
    transport = PahoMqttTransport(
        FakeHass(), host="localhost", port=1883,
        username=None, password=None, use_tls=False, client_id="test",
    )

    transport._client.connect = lambda *a, **k: None

    asyncio.run(transport.async_connect())

    assert transport._client._ssl_context is None
