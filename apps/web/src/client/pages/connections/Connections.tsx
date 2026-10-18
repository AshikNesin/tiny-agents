import { useParams } from "react-router-dom";
import { ConnectionDetail } from "./ConnectionDetail";
import { ConnectionsList } from "./ConnectionsList";

export function ConnectionsPage() {
  const { id } = useParams();
  return id ? <ConnectionDetail id={id} /> : <ConnectionsList />;
}
