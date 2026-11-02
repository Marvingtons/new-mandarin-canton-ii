/**
 * A dish name, ALWAYS in both languages: 中文 first and larger, English
 * beneath it in the secondary tone.
 *
 * Independent of the staff language toggle on purpose. The person taking a
 * phone order and the person cooking it may read different ones, so this is
 * the one thing in the staff area that is never single-language. Same order as
 * the printed ticket. A dish with no 中文 shows its English in the primary
 * slot rather than an empty line.
 */
export default function DishName({
  nameZh,
  nameEn,
  size = "md",
  className = "",
}: {
  nameZh: string | null;
  nameEn: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const zhClass = { sm: "text-base", md: "text-xl", lg: "text-2xl" }[size];
  const enClass = { sm: "text-xs", md: "text-sm", lg: "text-base" }[size];
  return (
    <span className={`flex min-w-0 flex-col ${className}`}>
      <span lang={nameZh ? "zh-Hant" : "en"} className={`font-semibold leading-snug ${zhClass}`}>
        {nameZh ?? nameEn}
      </span>
      {nameZh && (
        <span lang="en" className={`leading-snug opacity-75 ${enClass}`}>
          {nameEn}
        </span>
      )}
    </span>
  );
}
