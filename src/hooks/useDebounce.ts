import { useEffect, useState } from "react";

export const useDebouncedValue = (searchTerm: string, timeout = 500) => {
  const [debouncedValue, setDebouncedValue] = useState("");

  useEffect(() => {
    let timerId = setTimeout(() => {
      setDebouncedValue(searchTerm);
    }, timeout);

    return () => clearTimeout(timerId);
  }, [searchTerm]);

  return debouncedValue;
};
