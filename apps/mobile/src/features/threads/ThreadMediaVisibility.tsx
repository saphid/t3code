import { useViewabilityAmount } from "@legendapp/list/react-native";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

// LegendList only computes hook visibility when the list has a viewability config.
export const THREAD_ROW_VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 0 };

function createVisibilityStore(onObserved: (observed: boolean) => void) {
  let visible = false;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => visible,
    subscribe(listener: () => void) {
      listeners.add(listener);
      onObserved(true);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          onObserved(false);
        }
      };
    },
    setVisible(next: boolean) {
      if (visible === next) return;
      visible = next;
      for (const listener of listeners) listener();
    },
  };
}

const VisibilityContext = createContext<ReturnType<typeof createVisibilityStore> | null>(null);
const subscribeNever = () => () => {};
const hiddenSnapshot = () => false;

export function useThreadMediaVisible(override?: boolean): boolean {
  return useRowVisible(override, false);
}

// Non-feed shimmers, including the floating status overlay, animate by default.
export function useThreadRowVisible(override?: boolean): boolean {
  return useRowVisible(override, true);
}

function useRowVisible(override: boolean | undefined, standaloneVisible: boolean): boolean {
  const context = useContext(VisibilityContext);
  const store = override === undefined ? context : null;
  const visible = useSyncExternalStore(
    store?.subscribe ?? subscribeNever,
    store?.getSnapshot ?? hiddenSnapshot,
    hiddenSnapshot,
  );
  return override ?? (context ? visible : standaloneVisible);
}

function VisibilityObserver(props: { readonly onVisible: (visible: boolean) => void }) {
  const { onVisible } = props;
  // This observer is outside its own provider, so a nested list also observes its outer row.
  const parentVisible = useThreadRowVisible();
  const [visible, setVisible] = useState(false);
  useViewabilityAmount(useCallback((token) => setVisible(token.sizeVisible > 0), []));
  // oxlint-disable-next-line t3code/react-effect-budget -- Publish committed row visibility to the shared external store before drawing.
  useLayoutEffect(() => onVisible(visible && parentVisible), [onVisible, parentVisible, visible]);
  // oxlint-disable-next-line t3code/react-effect-budget -- Clear the last visibility when the native row observer unmounts.
  useLayoutEffect(() => () => onVisible(false), [onVisible]);
  return null;
}

/** LegendList has one callback slot per row, shared by media and animation consumers. */
export function ThreadMediaVisibility(props: { readonly children: ReactNode }) {
  const [observed, setObserved] = useState(false);
  const [store] = useState(() => createVisibilityStore(setObserved));
  return (
    <>
      <VisibilityContext value={store}>{props.children}</VisibilityContext>
      {observed ? <VisibilityObserver onVisible={store.setVisible} /> : null}
    </>
  );
}
