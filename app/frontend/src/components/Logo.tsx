import { ASSETS } from '@/lib/assets';
import { cn } from '@/lib/utils';

export default function Logo({ className }: { className?: string }) {
  return <img src={ASSETS.logo} alt="" aria-hidden="true" className={cn('h-8 w-8 object-contain', className)} />;
}
