"use client";

// Adapted from shadcn/ui useToast hook —— 极简本地 Toast Store
import * as React from "react";
import type { ToastProps, ToastActionElement } from "@/components/ui/toast";

const TOAST_LIMIT = 3;
const TOAST_REMOVE_DELAY = 4000;

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

type State = { toasts: ToasterToast[] };

type Action =
  | { type: "ADD_TOAST"; toast: ToasterToast }
  | { type: "UPDATE_TOAST"; toast: Partial<ToasterToast> & { id: string } }
  | { type: "DISMISS_TOAST"; toastId?: string }
  | { type: "REMOVE_TOAST"; toastId?: string };

const listeners: ((state: State) => void)[] = [];
let memoryState: State = { toasts: [] };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };
    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      };
    case "DISMISS_TOAST": {
      const { toastId } = action;
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          toastId === undefined || t.id === toastId
            ? { ...t, open: false }
            : t
        ),
      };
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) return { ...state, toasts: [] };
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
}

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((l) => l(memoryState));
}

interface ToastInput extends Omit<ToasterToast, "id"> {}

export function toast(props: ToastInput & { variant?: ToastProps["variant"] }) {
  const id = genId();

  const update = (next: Partial<ToasterToast>) =>
    dispatch({ type: "UPDATE_TOAST", toast: { ...next, id } });
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id });

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });

  window.setTimeout(() => {
    dispatch({ type: "REMOVE_TOAST", toastId: id });
  }, TOAST_REMOVE_DELAY);

  return { id, dismiss, update };
}

export function useToast() {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const idx = listeners.indexOf(setState);
      if (idx > -1) listeners.splice(idx, 1);
    };
  }, []);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  };
}

/** 把组件放在 layout 里即可显示 Toast */
export function Toaster() {
  const { toasts } = useToast();
  return (
    <ToastPrimitivesWrapper toasts={toasts} />
  );
}

// Re-export to avoid "use client" re-warnings
import {
  ToastProvider as P,
  ToastViewport as V,
  Toast as T,
  ToastTitle as TT,
  ToastDescription as TD,
  ToastClose as TC,
} from "@/components/ui/toast";

function ToastPrimitivesWrapper({ toasts }: { toasts: ToasterToast[] }) {
  return (
    <P>
      {toasts.map(({ id, title, description, action, ...rest }) => (
        <T key={id} {...rest}>
          <div className="grid gap-1">
            {title && <TT>{title}</TT>}
            {description && <TD>{description}</TD>}
          </div>
          {action}
          <TC />
        </T>
      ))}
      <V />
    </P>
  );
}
