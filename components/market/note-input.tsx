'use client';

import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export function NoteInput({ marketId, lang = 'zh' }: { marketId: string; lang?: 'zh' | 'en' }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const t =
    lang === 'en'
      ? { placeholder: 'Write your research note...', saving: 'Saving...', save: 'Save Note' }
      : { placeholder: '记录你的研究判断...', saving: '保存中...', save: '保存笔记' };

  return (
    <div className="space-y-2">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t.placeholder} />
      <Button
        size="sm"
        disabled={!text.trim() || saving}
        onClick={async () => {
          setSaving(true);
          try {
            await fetch('/api/notes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ marketId, noteText: text.trim() })
            });
            setText('');
            window.location.reload();
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? t.saving : t.save}
      </Button>
    </div>
  );
}
