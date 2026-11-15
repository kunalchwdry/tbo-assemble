# Manual supplier quote review

This is a **manual decision-support workflow**, not a supplier connection. It does not enquire, check live inventory, book, approve or purchase. The starting planner inventory may be synthetic, and demand, profit and risk calculations are unvalidated model estimates. All supplier details are user-supplied and must be checked independently.

## Enter and compare quotes

Use **Enter a quote manually**, download the CSV template, or try the clearly marked synthetic example. Manual timestamps are entered as UTC. Up to 100 quotes can be held in the browser tab. In CSV, each `quote_id` must be unique, `inventory_id` must match the planner, unit must be `seat` or `room-night`, and prices are INR per unit. `travel_period` is optional for CSV compatibility; older templates remain supported. Terms should be written explicitly or marked `Unknown`. Import is all-or-nothing; invalid files leave the existing list unchanged.

For two quotes linked to the same inventory ID, the side-by-side tool compares each temporary allocation with separate additional per-unit costs. It shows spend, modeled expected and low-case profit, unsold exposure and quantities. Different price bases, exact dates, taxes, supplier terms and availability are **not** automatically verified. The costs entered in side-by-side comparison are independent of the single-quote review; enter the intended cost again there before applying.

## Review and apply

Choose **Review impact** to compare one quote with the current unfiltered portfolio. The tool applies the quote to a temporary copy and recalculates allocation, modeled shortage, spend, profit and risk. The additional per-unit charge is modeled as non-recoverable: recovery on the underlying unit price is retained and recovery on the extra cost is zero. Existing fixed supplier fees and modeled cancellation assumptions remain unchanged. Written tax and cancellation terms are not interpreted; avoid double-counting and verify them manually.

To apply, complete the local self-check and confirm. The plan receives the quote unit price **plus the entered additional per-unit cost**, minimum units, capacity capped at the current capacity, adjusted recovery percentage, previous buy price, and conservative expiry date. It does not automatically create a supplier order. The self-check resets when inputs change and is not formal approval. Unapplied budget edits and loading live signals block application and saving.

The exact quote timestamps are checked again when applying using the user's device clock. The date-only planner uses the day **before** the quoted UTC expiry date as its last eligible day; a quote expiring today UTC cannot be applied. The selected planner review date is not a live expiry check and may be historical. Even a within-date quote is not verified or guaranteed bookable. To undo an applied quote, restore or re-import the original inventory inputs.

## Saved quote reviews

Signed-in users can explicitly save a snapshot of a selected quote comparison. The snapshot includes the supplied quote, current effective model inputs, budget/risk/date, extra cost, scenario totals and results. It is stored in the account-scoped `private_quote_reviews` table with row-level security. Users can view and delete their most recent 20 reviews; the account limit is 100. Saving does not apply a quote, preserve a live offer, place an order, or establish approval. Saved rows are user-generated and not a signed audit log; reopening a snapshot does not replay it into the plan. Other current tab quotes and checklist state remain unsaved unless separately saved as a review. Existing saved plans contain planner inputs, not the quote's identity or terms. After explicit application, the overview shows a session-only handoff and its downloadable decision review includes the entered supplier details and written terms; it reports if transferred fields have changed and whether supplied dates have expired. This may be sensitive: inspect the download before sharing. Refresh, replacing inventory or loading a saved plan clears that handoff, not the planner fields already copied.

Email ownership verification is disabled in the current account configuration. Do not store sensitive supplier or customer data until account security is strengthened. Legacy event and booking pages are separate and remain shared. The model's source label identifies its starting inputs, not independent verification; experimental demand or market adjustments may be present in effective inputs. Forecasts, written terms and supplier information require independent review.

## Supplier access

[TBO's API page](https://www.tbo.com/tbo-api) describes partner access, which the user does not currently have. [Travelpayouts' data API](https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API) supplies cached search information, not a supplier allotment or pre-buy order. No credentials are requested or stored by this manual workflow.
