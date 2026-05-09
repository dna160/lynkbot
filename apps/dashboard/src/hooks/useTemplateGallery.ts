import { useState, useEffect } from 'react';

type Language = 'en' | 'id';

export function useTemplateGallery() {
  const [language, setLanguage] = useState<Language>('en');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('lynkbot_gallery_lang') as Language | null;
    if (saved && (saved === 'en' || saved === 'id')) {
      setLanguage(saved);
    }
    setMounted(true);
  }, []);

  const switchLanguage = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('lynkbot_gallery_lang', lang);
  };

  return { language, switchLanguage, mounted };
}
