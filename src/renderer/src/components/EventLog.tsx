import type { UiEvent } from "../types.js";

export function EventLog({ events }: { events: UiEvent[] }) {
	return (
		<div className="event-log">
			{events.map((event) => (
				<div key={event.key} className={`event ${event.type}`}>
					<span>{event.timeLabel}</span>
					<strong>{event.type}</strong>
					<p>{event.message}</p>
				</div>
			))}
		</div>
	);
}
