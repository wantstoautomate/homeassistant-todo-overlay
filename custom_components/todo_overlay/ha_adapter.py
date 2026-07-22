import datetime

from homeassistant.components.todo import DATA_COMPONENT, TodoItemStatus

from .models import TodoItem


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
            raise ValueError(f"Unknown todo entity: {entity_id}")

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
        """

        before_ids = {item.id for item in await self.get_items(entity_id)}

        service_data: dict = {"entity_id": entity_id, "item": title}

        if description:
            service_data["description"] = description

        if due_datetime:
            service_data["due_datetime"] = due_datetime
        elif due_date:
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

        return new_items[0].id
