import { useParams } from "react-router-dom";
import { ConnectionDetail } from "./ConnectionDetail";
import { ConnectionsList } from "./ConnectionsList";
import { ConnectionToolDetail } from "./ConnectionToolDetail";
import { StepUpProvider } from "../../components/vault/StepUp";

export function ConnectionsPage() {
  const { id, tool } = useParams();
  const page =
    id && tool ? (
      <ConnectionToolDetail id={id} tool={tool} />
    ) : id ? (
      <ConnectionDetail id={id} />
    ) : (
      <ConnectionsList />
    );
  // Adding and removing a connection need step-up (S4).
  return <StepUpProvider>{page}</StepUpProvider>;
}
