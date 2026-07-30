"""Construction-only tests for PahoMqttTransport's transport/websocket
wiring - no real networking (that's covered separately against a real
local Mosquitto instance, both plain and websocket listeners, since
that's the only way to genuinely prove a live handshake/ACL/TLS work,
not something worth faking here)."""

from custom_components.todo_overlay.mqtt_link import PahoMqttTransport


class FakeHass:
    pass


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
