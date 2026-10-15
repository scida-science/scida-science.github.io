import { useState } from "react";
import { Link } from "react-router-dom";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { usePortal } from "../state/PortalContext";
import type { Discovery } from "../types";

export default function FollowDiscovery({ discovery }: { discovery: Discovery }) {
  const { user, configured, setFollowing } = usePortal();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const following = user?.followedDiscoveryIds?.includes(discovery.id) ?? false;
  if (!user) return <Link className="btn btn-secondary btn-small" to="/login">
    <Bookmark size={15} aria-hidden="true" /> Sign in to follow
  </Link>;
  return <div className="follow-control">
    <button type="button" className="btn btn-secondary btn-small follow-button"
      aria-pressed={following} aria-label={`${following ? "Unfollow" : "Follow"} ${discovery.title}`}
      disabled={pending || !configured}
      onClick={async () => {
        setPending(true);
        setError("");
        try {
          const result = await setFollowing(discovery.id, !following);
          if (!result.ok) setError(result.message);
        } catch {
          setError("Following could not be saved. Please try again.");
        } finally {
          setPending(false);
        }
      }}>
      {following ? <BookmarkCheck size={15} aria-hidden="true" /> : <Bookmark size={15} aria-hidden="true" />}
      {pending ? "Saving…" : following ? "Following" : "Follow"}
    </button>
    {error && <p className="follow-error" role="alert">{error}</p>}
  </div>;
}
