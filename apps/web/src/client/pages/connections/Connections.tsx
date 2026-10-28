import { useParams } from "react-router-dom";
import { ConnectionDetail } from "./ConnectionDetail";
import { ConnectionsList } from "./ConnectionsList";
import { ConnectionToolDetail } from "./ConnectionToolDetail";

export function ConnectionsPage() {
  const { id, tool } = useParams();
  if (id && tool) return <ConnectionToolDetail id={id} tool={tool} />;
  return id ? <ConnectionDetail id={id} /> : <ConnectionsList />;
}
