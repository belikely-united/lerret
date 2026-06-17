// react-instance.js — the hosted import map's `react` target.
//
// `export * from 'react'` is tree-shaken to nothing by Rolldown (React is a CJS
// module, so the star has no statically-known names to preserve). The import-map
// target therefore re-exports React 19's public API EXPLICITLY. These all
// resolve to the studio's bundled React (a shared chunk), so SW-served user
// assets share the one instance. Revisit this list on a React major bump.
// (Epic 10 / Story H1.2.)
export {
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  use,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} from 'react';
export { default } from 'react';
