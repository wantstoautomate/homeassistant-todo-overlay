import pytest

from custom_components.todo_overlay.metadata_store import (
    QUANTITIES_KEY,
    TAGS_KEY,
    MetadataStore,
    _TodoOverlayStore,
)


class FakeStore:
    """Stands in for homeassistant.helpers.storage.Store - just enough to
    drive MetadataStore's business logic without a real hass."""

    def __init__(self, initial=None):
        self.saved: dict | None = initial
        self.delay_save_calls = 0

    async def async_load(self):
        return self.saved

    def async_delay_save(self, data_func, delay=0):
        self.delay_save_calls += 1
        self.saved = data_func()


def make_store(initial_cache=None) -> tuple[MetadataStore, FakeStore]:
    """Build a MetadataStore backed by a FakeStore, bypassing __init__
    (which would otherwise construct a real _TodoOverlayStore needing a
    real hass)."""

    metadata_store = MetadataStore.__new__(MetadataStore)
    fake_store = FakeStore(initial_cache)
    metadata_store._store = fake_store
    metadata_store._cache = None

    return metadata_store, fake_store


@pytest.mark.asyncio
async def test_clear_entity_drops_positions_quantities_and_tags():
    store, fake = make_store({
        "todo.a": {"1": {"parent": None, "order": 0}},
        "todo.b": {"2": {"parent": None, "order": 0}},
        QUANTITIES_KEY: {"todo.a": {"1": "2L"}, "todo.b": {"2": "1kg"}},
        TAGS_KEY: {"todo.a": {"1": ["urgent"]}, "todo.b": {"2": ["deli"]}},
    })

    await store.clear_entity("todo.a")

    assert "todo.a" not in fake.saved
    assert "todo.a" not in fake.saved[QUANTITIES_KEY]
    assert "todo.a" not in fake.saved[TAGS_KEY]
    # Untouched: a different entity's data must survive.
    assert fake.saved["todo.b"] == {"2": {"parent": None, "order": 0}}
    assert fake.saved[QUANTITIES_KEY]["todo.b"] == {"2": "1kg"}
    assert fake.saved[TAGS_KEY]["todo.b"] == {"2": ["deli"]}


@pytest.mark.asyncio
async def test_clear_entity_is_a_noop_for_unknown_entity():
    store, fake = make_store({"todo.b": {"2": {"parent": None, "order": 0}}})

    await store.clear_entity("todo.a")

    assert fake.saved["todo.b"] == {"2": {"parent": None, "order": 0}}


@pytest.mark.asyncio
async def test_rename_entity_moves_positions_quantities_and_tags():
    store, fake = make_store({
        "todo.old": {"1": {"parent": None, "order": 0}},
        QUANTITIES_KEY: {"todo.old": {"1": "2L"}},
        TAGS_KEY: {"todo.old": {"1": ["urgent"]}},
    })

    await store.rename_entity("todo.old", "todo.new")

    assert "todo.old" not in fake.saved
    assert fake.saved["todo.new"] == {"1": {"parent": None, "order": 0}}
    assert "todo.old" not in fake.saved[QUANTITIES_KEY]
    assert fake.saved[QUANTITIES_KEY]["todo.new"] == {"1": "2L"}
    assert "todo.old" not in fake.saved[TAGS_KEY]
    assert fake.saved[TAGS_KEY]["todo.new"] == {"1": ["urgent"]}


@pytest.mark.asyncio
async def test_rename_entity_is_a_noop_when_old_entity_has_no_data():
    store, fake = make_store({"todo.other": {"1": {"parent": None, "order": 0}}})

    await store.rename_entity("todo.old", "todo.new")

    assert "todo.new" not in fake.saved
    assert fake.saved["todo.other"] == {"1": {"parent": None, "order": 0}}


@pytest.mark.asyncio
async def test_writes_are_delayed_not_immediate():
    """Every mutation should go through async_delay_save, not a direct
    synchronous save - see metadata_store.py's SAVE_DELAY comment for why
    (batching a multi-step operation into one disk write)."""

    store, fake = make_store({})

    await store.set_quantity("todo.a", "1", "2L")

    assert fake.delay_save_calls == 1
    assert fake.saved[QUANTITIES_KEY]["todo.a"]["1"] == "2L"


@pytest.mark.asyncio
async def test_migrate_func_passes_data_through_without_raising():
    """The base Store's default _async_migrate_func raises
    NotImplementedError for any unrecognised version, which Store.async_load
    re-raises outright - this override exists so an old version doesn't
    hard-crash setup. Not a real v1 -> v2 transform (see its docstring),
    just a safety net: verify it returns the old data unchanged."""

    fake_store = _TodoOverlayStore.__new__(_TodoOverlayStore)
    fake_store.key = "todo_overlay"
    fake_store.version = 2
    fake_store.minor_version = 1

    old_data = {"todo.a": {"1": {"parent": None, "order": 0}}}

    result = await fake_store._async_migrate_func(1, 1, old_data)

    assert result is old_data
