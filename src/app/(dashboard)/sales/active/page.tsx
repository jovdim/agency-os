import { requireRole } from "@/lib/auth/guards";
import { fetchActiveContacts } from "@/lib/sales/fetch-active";
import { ActiveClient } from "./active-client";

export const dynamic = "force-dynamic";

export default async function SalesActivePage() {
  const { profile } = await requireRole("sales");
  const {
    contacts,
    outcomes,
    contactsWithProposals,
    loggedOutcomes,
    activeProposalIdByContact,
    proposalTagsByContact,
    proposalStatusByContact,
    updateStateByContact,
    lastPublishedByContact,
  } = await fetchActiveContacts(profile.id);

  return (
    <ActiveClient
      contacts={contacts}
      outcomes={outcomes}
      contactsWithProposals={contactsWithProposals}
      loggedOutcomes={loggedOutcomes}
      activeProposalIdByContact={activeProposalIdByContact}
      proposalTagsByContact={proposalTagsByContact}
      proposalStatusByContact={proposalStatusByContact}
      updateStateByContact={updateStateByContact}
      lastPublishedByContact={lastPublishedByContact}
    />
  );
}
