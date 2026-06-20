import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { formatInvokeError } from "@/lib/operations";

export type OperationKind = "refresh" | "pull" | "push" | "add";

interface PerProjectState {
  running: boolean;
  currentOp?: OperationKind;
  lastError?: string;
}

interface OperationContextValue {
  globalLoading: Record<OperationKind, boolean>;
  state: (projectId: string) => PerProjectState;
  startOp: (projectId: string, op: OperationKind) => void;
  completeOp: (projectId: string, op: OperationKind, error?: string) => void;
  setGlobal: (op: OperationKind, loading: boolean) => void;
  runSingle: <T>(
    projectId: string,
    op: OperationKind,
    fn: () => Promise<T>,
  ) => Promise<T>;
  clearError: (projectId: string) => void;
}

// Split into two contexts: stable actions (never change) and reactive state.
// This prevents infinite re-render loops when actions like setGlobal cause
// state changes that would otherwise invalidate callbacks depending on the context.
const ActionsContext = createContext<{
  startOp: (projectId: string, op: OperationKind) => void;
  completeOp: (projectId: string, op: OperationKind, error?: string) => void;
  setGlobal: (op: OperationKind, loading: boolean) => void;
  runSingle: <T>(projectId: string, op: OperationKind, fn: () => Promise<T>) => Promise<T>;
  clearError: (projectId: string) => void;
} | null>(null);

const StateContext = createContext<{
  globalLoading: Record<OperationKind, boolean>;
  state: (projectId: string) => PerProjectState;
} | null>(null);

function emptyPer(): PerProjectState {
  return { running: false };
}

export function OperationProvider({ children }: { children: ReactNode }) {
  const [perProject, setPerProject] = useState<Record<string, PerProjectState>>({});
  const [globalLoading, setGlobalLoading] = useState<Record<OperationKind, boolean>>({
    refresh: false,
    pull: false,
    push: false,
    add: false,
  });

  const startOp = useCallback((projectId: string, op: OperationKind) => {
    setPerProject((prev) => ({
      ...prev,
      [projectId]: {
        ...(prev[projectId] ?? emptyPer()),
        running: true,
        currentOp: op,
      },
    }));
  }, []);

  const completeOp = useCallback((projectId: string, op: OperationKind, error?: string) => {
    setPerProject((prev) => ({
      ...prev,
      [projectId]: {
        running: false,
        currentOp: op,
        lastError: error ? error : undefined,
      },
    }));
  }, []);

  const setGlobal = useCallback((op: OperationKind, loading: boolean) => {
    setGlobalLoading((prev) => ({ ...prev, [op]: loading }));
  }, []);

  const runSingle = useCallback(
    async <T,>(projectId: string, op: OperationKind, fn: () => Promise<T>): Promise<T> => {
      startOp(projectId, op);
      try {
        const result = await fn();
        completeOp(projectId, op);
        return result;
      } catch (e) {
        const message = formatInvokeError(e);
        completeOp(projectId, op, message);
        throw e;
      }
    },
    [startOp, completeOp],
  );

  const clearError = useCallback((projectId: string) => {
    setPerProject((prev) => {
      const current = prev[projectId];
      if (!current || !current.lastError) return prev;
      return {
        ...prev,
        [projectId]: { ...current, lastError: undefined },
      };
    });
  }, []);

  useEffect(() => {
    const unsubscribers: Array<() => void> = [];

    const startHandler = (payload: unknown) => {
      const p = payload as { project_id?: string; operation?: string } | undefined;
      const pid = p?.project_id;
      const op = (p?.operation as OperationKind) ?? "refresh";
      if (pid) startOp(pid, op);
    };

    const completeHandler = (payload: unknown) => {
      const p = payload as
        | { project_id?: string; operation?: string; result?: { success?: boolean; error?: string } }
        | undefined;
      const pid = p?.project_id;
      const op = (p?.operation as OperationKind) ?? "refresh";
      const err =
        p?.result && typeof p.result === "object" && p.result.success === false
          ? (p.result.error ?? "操作失败")
          : undefined;
      if (pid) completeOp(pid, op, err);
    };

    (async () => {
      try {
        const start = await listen("operation-start", (event) => startHandler(event.payload));
        unsubscribers.push(start as unknown as () => void);
        const complete = await listen("operation-complete", (event) =>
          completeHandler(event.payload),
        );
        unsubscribers.push(complete as unknown as () => void);
      } catch {
        // ignore: 未在 Tauri 环境运行时继续使用前端状态管理
      }
    })();

    return () => {
      unsubscribers.forEach((fn) => {
        try {
          fn();
        } catch {
          // noop
        }
      });
    };
  }, [startOp, completeOp]);

  const actionsValue = useMemo(
    () => ({ startOp, completeOp, setGlobal, runSingle, clearError }),
    [startOp, completeOp, setGlobal, runSingle, clearError],
  );

  const stateValue = useMemo(
    () => ({
      globalLoading,
      state: (projectId: string) => perProject[projectId] ?? emptyPer(),
    }),
    [globalLoading, perProject],
  );

  return (
    <ActionsContext.Provider value={actionsValue}>
      <StateContext.Provider value={stateValue}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useOperations(): OperationContextValue {
  const actions = useContext(ActionsContext);
  const state = useContext(StateContext);
  if (!actions || !state) {
    throw new Error("useOperations 必须在 <OperationProvider> 内部使用");
  }
  return { ...state, ...actions };
}

/**
 * Returns only the stable action functions from OperationContext.
 * Use this in useCallback/useEffect deps to avoid infinite re-render loops
 * caused by reactive state changes (globalLoading, perProject).
 */
export function useOperationActions() {
  const actions = useContext(ActionsContext);
  if (!actions) {
    throw new Error("useOperationActions 必须在 <OperationProvider> 内部使用");
  }
  return actions;
}
