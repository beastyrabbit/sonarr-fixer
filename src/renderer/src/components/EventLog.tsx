import type { UiEvent } from "../types.js";

export function EventLog({ events }: { events: UiEvent[] }) {
	return (
		<div className="event-log">
			{events.map((event) => (
				<div key={event.key} className={`event ${event.type}`}>
					<span>{event.timeLabel}</span>
					<strong>{event.type}</strong>
					<div className="event-content">
						<p>{event.message}</p>
						{event.details !== undefined && (
							<details className="event-details">
								<summary>structured details</summary>
								<pre>{JSON.stringify(event.details, null, 2)}</pre>
							</details>
						)}
					</div>
				</div>
			))}
		</div>
	);
}
