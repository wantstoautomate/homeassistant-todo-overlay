DOMAIN = "todo_overlay"

WS_TYPE_GET_LIST = "todo_overlay/get_list"
WS_TYPE_MOVE_ITEM = "todo_overlay/move_item"
WS_TYPE_TRANSFER_ITEM = "todo_overlay/transfer_item"
WS_TYPE_SET_COMPLETED = "todo_overlay/set_completed"
WS_TYPE_RESTORE_COMPLETED = "todo_overlay/restore_completed"
WS_TYPE_CLEAR_COMPLETED = "todo_overlay/clear_completed"
WS_TYPE_CLEAR_ALL = "todo_overlay/clear_all"
WS_TYPE_SAVE_LIST = "todo_overlay/save_list"
WS_TYPE_LOAD_LIST = "todo_overlay/load_list"
WS_TYPE_LIST_SAVED = "todo_overlay/list_saved"
WS_TYPE_DELETE_SAVED_LIST = "todo_overlay/delete_saved_list"
WS_TYPE_CREATE_ITEM = "todo_overlay/create_item"
WS_TYPE_UPDATE_ITEM = "todo_overlay/update_item"
WS_TYPE_DELETE_ITEM = "todo_overlay/delete_item"
WS_TYPE_SET_QUANTITY = "todo_overlay/set_quantity"
WS_TYPE_SET_TAGS = "todo_overlay/set_tags"
WS_TYPE_ADD_TAG = "todo_overlay/add_tag"
WS_TYPE_REMOVE_TAG = "todo_overlay/remove_tag"
WS_TYPE_SET_TRIGGER_ON_DUE = "todo_overlay/set_trigger_on_due"

SERVICE_SAVE_LIST = "save_list"
SERVICE_LOAD_LIST = "load_list"
SERVICE_DELETE_SAVED_LIST = "delete_saved_list"
SERVICE_ADD_TAG = "add_tag"
SERVICE_REMOVE_TAG = "remove_tag"
SERVICE_CREATE_ITEM = "create_item"
SERVICE_SET_QUANTITY = "set_quantity"
SERVICE_SET_TRIGGER_ON_DUE = "set_trigger_on_due"
SERVICE_CREATE_LINK = "create_link"
SERVICE_JOIN_LINK = "join_link"
SERVICE_UNLINK = "unlink"

# Options-flow keys for the (optional, instance-wide) MQTT broker used
# for linked lists - see mqtt_link.py/link_sync.py. Absent entirely
# unless the user has actually configured a broker.
CONF_MQTT_HOST = "mqtt_host"
CONF_MQTT_PORT = "mqtt_port"
CONF_MQTT_USERNAME = "mqtt_username"
CONF_MQTT_PASSWORD = "mqtt_password"
CONF_MQTT_TLS = "mqtt_tls"
# "tcp" (default - a direct/LAN broker connection) or "websockets" (for
# reaching a broker fronted by a reverse proxy's WSS, e.g. NPM, without
# needing a dedicated forwarded port - see mqtt_link.py). Each HA
# instance's broker connection is independent, so one side of a link can
# use tcp while the other uses websockets against the very same broker.
CONF_MQTT_TRANSPORT = "mqtt_transport"
CONF_MQTT_WS_PATH = "mqtt_ws_path"

ATTR_NAME = "name"
ATTR_PERSIST_STATES = "persist_states"
ATTR_MODE = "mode"
ATTR_ITEM = "item"
ATTR_TAG = "tag"
ATTR_TITLE = "title"
ATTR_DESCRIPTION = "description"
ATTR_DUE_DATE = "due_date"
ATTR_DUE_DATETIME = "due_datetime"
ATTR_QUANTITY = "quantity"
ATTR_TAGS = "tags"
ATTR_ENABLED = "enabled"
ATTR_TRIGGER_ON_DUE = "trigger_on_due"
ATTR_LINK_ID = "link_id"

# The exact shape create_link's uuid.uuid4().hex always produces. join_link
# must reject anything else - a link_id is spliced directly into an MQTT
# topic filter (see link_sync.py), so an unvalidated value containing "+"
# or "#" would turn a single link's subscription into a broker-wide
# wildcard, leaking and cross-writing every other link's traffic.
LINK_ID_PATTERN = r"^[0-9a-f]{32}$"

# Fired whenever a meaningful change happens to a list's items, so
# automations can react via the todo_overlay trigger platform.
EVENT_ITEM_CHANGED = "todo_overlay_item_event"
