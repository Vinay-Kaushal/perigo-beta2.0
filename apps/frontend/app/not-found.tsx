import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-medium text-accent-ink">404</p>
      <h1 className="mt-2 text-xl font-semibold text-ink">This page doesn&apos;t exist — or you don&apos;t have access to it.</h1>
      <Link href="/dashboard" className="mt-6 text-sm font-medium text-accent-ink hover:underline">
        Back to home
      </Link>
    </div>
  );
}
