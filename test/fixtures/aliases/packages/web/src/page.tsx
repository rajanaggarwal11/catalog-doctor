import { useState } from "react";
import { helper } from "@/lib/helper";
import { format } from "~utils/format";
import {
  somethingElse,
  andAnother,
} from "undeclared-package";

export default function Page() {
  const [open] = useState(false);
  return (
    <div>
      <p>
        You can import those from a document, or paste them in.
      </p>
      <form action={helper} data-testid="import-upload" data-open={open}>
        <input type="date" name="from" defaultValue={format("")} />
      </form>
    </div>
  );
}
