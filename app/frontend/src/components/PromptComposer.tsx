import { useEffect, useRef } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PromptComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  size?: 'lg' | 'sm';
  footer?: React.ReactNode;
  label: string;
}

export default function PromptComposer({
  value,
  onChange,
  onSubmit,
  loading,
  disabled,
  placeholder,
  size = 'lg',
  footer,
  label,
}: PromptComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSubmit = value.trim().length > 0 && !loading && !disabled;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, size === 'lg' ? 220 : 160)}px`;
  }, [value, size]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit();
      }}
      className={cn(
        'rounded-[28px] border border-border/70 bg-card text-card-foreground transition-shadow focus-within:ring-2 focus-within:ring-ring/40',
        size === 'lg' ? 'p-5 shadow-xl' : 'p-3 shadow-md rounded-[22px]',
      )}
    >
      <label className="sr-only" htmlFor={`composer-${size}`}>
        {label}
      </label>
      <textarea
        id={`composer-${size}`}
        ref={ref}
        rows={size === 'lg' ? 3 : 2}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSubmit) onSubmit();
          }
        }}
        className={cn(
          'w-full resize-none bg-transparent leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60',
          size === 'lg' ? 'text-base' : 'text-sm',
        )}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">{footer}</div>
        <button
          type="submit"
          aria-label="发送"
          disabled={!canSubmit}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30',
            size === 'lg' ? 'h-11 w-11' : 'h-9 w-9',
          )}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );
}
