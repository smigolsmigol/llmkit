import { UserButton } from '@clerk/nextjs';

export function Header() {
  return (
    <header className="glass flex h-14 items-center justify-end border-b border-border px-6">
      <UserButton
        appearance={{
          elements: { avatarBox: 'h-8 w-8' },
        }}
      />
    </header>
  );
}
