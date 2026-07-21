export interface TodoItem {
    id: string;
    title: string;
    completed: boolean;
    children: TodoItem[];
}

export interface TodoList {
    entity_id: string;
    items: TodoItem[];
}
