class RelationshipRepository:
    """Stores parent-child relationships."""

    def get_relationships(self) -> dict[str, str | None]:
        """
        Return:

            child_id -> parent_id
        """

        return {
            "1": None,
            "2": "1",
            "3": "1",
        }
