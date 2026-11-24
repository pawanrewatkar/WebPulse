import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card p-8 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-1 text-sm text-gray-600">The requested item does not exist.</p>
      <Link href="/" className="btn mt-4">Back to dashboard</Link>
    </div>
  );
}
