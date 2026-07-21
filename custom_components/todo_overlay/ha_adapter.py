from homeassistant.components.todo import DATA_COMPONENT, TodoItemStatus

from .models import TodoItem


class HomeAssistantTodoProvider:
    """Reads Todo items from Home Assistant."""

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

        return [
            TodoItem(
                id=item.uid or "",
                title=item.summary or "",
                completed=item.status == TodoItemStatus.COMPLETED,
            )
            for item in (entity.todo_items or [])
        ]
