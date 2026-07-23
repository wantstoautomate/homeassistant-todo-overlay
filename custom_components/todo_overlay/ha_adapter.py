import datetime
import logging

from homeassistant.components.todo import (
    DATA_COMPONENT,
    TodoItemStatus,
    TodoListEntityFeature,
)

from .errors import EntityNotFoundError
from .models import TodoItem

_LOGGER = logging.getLogger(__name__)


def _due_fields(
    due: datetime.date | datetime.datetime | None,
) -> tuple[str | None, str | None]:
    """Split HA's unified `due` field into the date/datetime pair our
    model and the todo.update_item/add_item services both use."""

    if isinstance(due, datetime.datetime):
        return None, due.isoformat()

    if isinstance(due, datetime.date):
        return due.isoformat(), None

    return None, None


class HomeAssistantTodoProvider:
    """Reads and writes Todo items via Home Assistant's todo integration."""

    def __init__(self, hass) -> None:
        self._hass = hass

    async def get_items(
        self,
        entity_id: str,
    ) -> list[TodoItem]:

        component = self._hass.data[DATA_COMPONENT]

        entity = component.get_entity(entity_id)

        if entity is None:
            raise EntityNotFoundError(f"Unknown todo entity: {entity_id}")

        items = []

        for item in (entity.todo_items or []):
            due_date, due_datetime = _due_fields(item.due)

            items.append(
                TodoItem(
                    id=item.uid or "",
                    title=item.summary or "",
                    completed=item.status == TodoItemStatus.COMPLETED,
                    description=item.description,
                    due_date=due_date,
                    due_datetime=due_datetime,
                )
            )

        return items

    async def set_completed(
        self,
        entity_id: str,
        item_id: str,
        completed: bool,
    ) -> None:
        await self._hass.services.async_call(
            "todo",
            "update_item",
            {
                "entity_id": entity_id,
                "item": item_id,
                "status": (
                    TodoItemStatus.COMPLETED
                    if completed
                    else TodoItemStatus.NEEDS_ACTION
                ),
            },
            blocking=True,
        )

    async def remove_item(
        self,
        entity_id: str,
        item_id: str,
    ) -> None:
        await self._hass.services.async_call(
            "todo",
            "remove_item",
            {
                "entity_id": entity_id,
                "item": item_id,
            },
            blocking=True,
        )

    def _supported_features(self, entity_id: str) -> int:
        state = self._hass.states.get(entity_id)

        if state is None:
            return 0

        return state.attributes.get("supported_features", 0) or 0

    async def add_item(
        self,
        entity_id: str,
        title: str,
        description: str | None = None,
        due_date: str | None = None,
        due_datetime: str | None = None,
    ) -> str:
        """Create an item and return its new uid.

        todo.add_item doesn't return the created item itself, so the
        new uid is found by diffing the item list before and after.

        Fields the target entity doesn't support (e.g. loading a
        snapshot with due dates onto a list that doesn't support them -
        saved snapshots are entity-agnostic, so this is a real case,
        not a hypothetical one) are silently dropped rather than
        letting the service call fail outright over one field.
        """

        before_ids = {item.id for item in await self.get_items(entity_id)}

        supported = self._supported_features(entity_id)

        service_data: dict = {"entity_id": entity_id, "item": title}

        if description and supported & TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM:
            service_data["description"] = description

        if due_datetime and supported & TodoListEntityFeature.SET_DUE_DATETIME_ON_ITEM:
            service_data["due_datetime"] = due_datetime
        elif due_date and supported & TodoListEntityFeature.SET_DUE_DATE_ON_ITEM:
            service_data["due_date"] = due_date

        await self._hass.services.async_call(
            "todo",
            "add_item",
            service_data,
            blocking=True,
        )

        after_items = await self.get_items(entity_id)
        new_items = [item for item in after_items if item.id not in before_ids]

        if not new_items:
            raise RuntimeError(f"Failed to determine new item id after adding {title!r}")

        if len(new_items) > 1:
            # Something else (a voice assistant, another concurrent
            # add_item/load_list call) added an item in the same window
            # between the before/after reads used to spot the new one -
            # there's no way to tell which of new_items is actually ours,
            # so this picks one arbitrarily and could silently attach
            # quantity/tags/events to the wrong item. TodoManager's
            # per-entity lock (see manager.py) makes this very unlikely
            # for calls that go through it, but add_item can still be
            # reached while something outside this integration entirely
            # is adding to the same list at the same moment.
            _LOGGER.warning(
                "Ambiguous new item after adding %r to %s: %d candidates, picking %r",
                title, entity_id, len(new_items), new_items[0].id,
            )

        return new_items[0].id
