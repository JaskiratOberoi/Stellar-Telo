import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-6 text-center">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">Telo</h1>
        <p className="mt-2 text-muted-foreground">
          B2C billing for the Noble laboratory network
        </p>
      </div>
      <Link
        href="/login"
        className="rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Sign in
      </Link>
    </main>
  );
}
