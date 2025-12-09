import { useCallback, useRef } from 'react';
import { AnyFunction } from '../types/types.ts';

export const useDebounce = (func: AnyFunction, wait = 250) => {
  const timeout = useRef<ReturnType<typeof setTimeout>>(null);

  return useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (...args: any[]) => {
      const later = () => {
        if (timeout.current) clearTimeout(timeout.current);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        func(...args);
      };

      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = setTimeout(later, wait);
    },
    [func, wait]
  );
};
