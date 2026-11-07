import { useState } from 'react';
import { LogOut, User } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface AccountMenuProps {
  displayName: string;
  email?: string;
  onLogout: () => Promise<void>;
  /** Icon-only trigger for narrow headers. */
  compact?: boolean;
}

/** Shows who is signed in and offers the sign-out action. */
export default function AccountMenu({ displayName, email, onLogout, compact }: AccountMenuProps) {
  const [busy, setBusy] = useState(false);
  const initial = displayName.trim().charAt(0).toUpperCase() || '我';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`当前登录：${displayName}`}
        className={cn(
          'inline-flex h-10 items-center gap-2 rounded-full border border-border text-sm font-medium hover:bg-muted',
          compact ? 'w-10 justify-center' : 'px-3',
        )}
      >
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
          {initial}
        </span>
        {!compact && <span className="max-w-[120px] truncate">{displayName}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
          {email && <p className="mt-0.5 truncate text-xs text-muted-foreground">{email}</p>}
          <p className="mt-1 text-xs text-muted-foreground">项目和版本只对这个账号可见</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/#projects" className="cursor-pointer">
            <User className="mr-2 h-4 w-4" />
            我的项目
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy}
          onSelect={(e) => {
            e.preventDefault();
            setBusy(true);
            void onLogout().finally(() => setBusy(false));
          }}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          {busy ? '正在退出…' : '退出登录'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
