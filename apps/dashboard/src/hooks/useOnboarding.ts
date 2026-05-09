import { useCallback, useState, useEffect } from 'react';

const ONBOARDING_KEY = 'lynkbot_onboarding_complete';

export function useOnboarding() {
  const [isComplete, setIsComplete] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(ONBOARDING_KEY);
    setIsComplete(stored === 'true');
  }, []);

  const markComplete = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setIsComplete(true);
  }, []);

  const reset = useCallback(() => {
    localStorage.removeItem(ONBOARDING_KEY);
    setIsComplete(false);
  }, []);

  return { isComplete, markComplete, reset };
}
