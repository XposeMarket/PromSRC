# Reviewer focus

The important invariant is that one mobile request may legitimately have two transcript rows with one `clientRequestId`: a user row and an assistant row. The runtime adapter must keep those rows distinct and bind streaming updates only to the assistant row.
