import Icon, { type IconName } from "@/components/kitchen/Icon";

/**
 * Nothing to show, and what to do about it. Every empty state in the staff
 * app says the next step, not just that the list is empty.
 */
export default function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-staff-sunken text-staff-soft">
        <Icon name={icon} size={28} />
      </span>
      <h2 className="text-staff-title font-semibold">{title}</h2>
      {body && <p className="max-w-[34em] text-staff-body text-staff-soft">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
