import { Effect, composeEffects, noop } from "./effects";
import { Param, changes, isValue, UnwrapList, unwrap, map } from "./param";


export interface Component<NodeType = undefined> {
    node?: NodeType;
    update: Effect;
    dispose: Effect;
}

export function beforeUpdate<NodeType>(component: Component<NodeType>, effect: Effect): Component<NodeType> {
    return {
        node: component.node,
        update: composeEffects(effect, component.update),
        dispose: component.dispose,
    };
}

export function afterUpdate<NodeType>(component: Component<NodeType>, effect: Effect): Component<NodeType> {
    return {
        node: component.node,
        update: composeEffects(component.update, effect),
        dispose: component.dispose,
    };
}

export function beforeDispose<NodeType>(component: Component<NodeType>, effect: Effect): Component<NodeType> {
    return {
        node: component.node,
        update: component.update,
        dispose: composeEffects(effect, component.dispose),
    };
}

export function afterDispose<NodeType>(component: Component<NodeType>, effect: Effect): Component<NodeType> {
    return {
        node: component.node,
        update: component.update,
        dispose: composeEffects(component.dispose, effect),
    };
}

export interface Factory<NodeType> {
    none(): NodeType;
    container(): NodeType;
    append(parent: NodeType, child: NodeType): void;
    order(parent: NodeType, children: NodeType[]): void;
    merge(node1: NodeType, node2: NodeType): NodeType;
}

export function createContainerComponents<NodeType>(factory: Factory<NodeType>) {

    function optional(flag: Param<Boolean>, create: () => Component<NodeType>): Component<NodeType> {
        if (isValue(flag)) {
            if (flag) {
                return create();
            } else {
                return {
                    update: noop,
                    dispose: noop,
                };
            }
        } else {
            const container = factory.container();

            let child: Component<NodeType> | null = null;
            const update = changes(flag)(flag => {
                if (flag) {
                    child = create();
                    child.node && factory.append(container, child.node);
                } else {
                    child?.dispose();
                    child = null;
                }
            });

            return {
                node: container,
                update: composeEffects(update, () => child?.update()),
                dispose: () => child?.dispose(),
            };
        }
    }

    function cond(
        flag: Param<Boolean>,
        ifTrue: () => Component<NodeType>,
        ifFalse: () => Component<NodeType>,
    ) {
        return group(
            optional(flag, ifTrue),
            optional(map(flag)(v => !v), ifFalse),
        );
    }

    function list<T>(
        items: Param<T[]>,
        key: (value: T, i: number) => string | number,
        create: (value: Param<T>) => Component<NodeType>,
    ) {
        const container = factory.container(),
            children = new Map<string | number, Component<NodeType>>(),
            values = new Map<string | number, T>();

        const update = changes(items)(items => {
            const keys = new Set<string | number>();

            items.forEach((v, i) => {
                const k = key(v, i);
                keys.add(k);
                values.set(k, v);

                if (!children.has(k)) {
                    const child = create(() => values.get(k)!);
                    children.set(k, child);
                    child.node && factory.append(container, child.node);
                }
            });
            
            children.forEach((v, k) => {
                if (!keys.has(k)) {
                    v.dispose();
                    children.delete(k);
                    values.delete(k);
                }
            });

            factory.order(container, Array.from(children.values()).filter(v => !!v).map(v => v.node!));
        });

        return {
            node: container,
            dispose: () => children.forEach(component => component.dispose()),
            update: composeEffects(update, () => {
                children.forEach(component => component.update());
            }),
        };
    }

    function group(...components: Component<NodeType>[]) {
        return {
            node: components.reduce((r, v) => {
                return v.node ? factory.merge(r, v.node) : r;
            }, factory.none()),
            update: composeEffects(...components.map(c => c.update)),
            dispose: composeEffects(...components.map(c => c.dispose)),
        };
    }

    return {
        optional,
        cond,
        list,
        group,
    };
}
