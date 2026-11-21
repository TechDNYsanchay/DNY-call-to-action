import type { CallRow, LineSummary } from "@/lib/data/calls";
import type { StageOptions } from "@/lib/ui/call-status";
import type { InboxGroup } from "@/lib/ui/group-meetings";
import { ListGroup } from "@/components/ui/page-header";
import { CallListRow } from "./call-list-row";

// The Calls list's groups ("Needs your decision", "Processing", then by day), each a card of rows. Rendered by
// the page on the server, and in the browser for a search by number, whose results never pass through the URL.

export function CallGroups({ groups, lines, stageOptions, now }: { groups: Array<InboxGroup<CallRow>>; lines: Map<string, LineSummary>; stageOptions: StageOptions; now: Date }) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <ListGroup key={group.key} title={group.title} count={group.rows.length} quiet={group.key === "processing"}>
          {group.rows.map((row) => (
            <CallListRow key={row.id} row={row} lines={lines} stageOptions={stageOptions} now={now} />
          ))}
        </ListGroup>
      ))}
    </div>
  );
}
