import { Suspense } from "react";
import { FeedList } from "@/components/FeedList";

// useSearchParams (in FeedList) requires a Suspense boundary for the
// static-export prerender step in Next.js 16.
export default function FeedPage() {
  return (
    <Suspense fallback={null}>
      <FeedList />
    </Suspense>
  );
}
