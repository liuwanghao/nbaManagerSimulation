import { useId, useRef, useState } from "react";
import { EXPANSION_POSITION_FILTERS, type ExpansionPositionFilter } from "./expansionDraftView";

export interface PlayerFilterSortOption<T extends string> {
  value: T;
  label: string;
  direction: string;
}

interface PlayerListFiltersProps<T extends string> {
  ariaLabel: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  sortValue: T;
  onSortChange: (value: T) => void;
  sortOptions: Array<PlayerFilterSortOption<T>>;
  positionValue: ExpansionPositionFilter;
  onPositionChange: (value: ExpansionPositionFilter) => void;
  positionCounts: Record<ExpansionPositionFilter, number>;
  testIdPrefix?: string;
}

export function PlayerListFilters<T extends string>({
  ariaLabel,
  searchValue,
  onSearchChange,
  searchPlaceholder = "搜索球员姓名",
  sortValue,
  onSortChange,
  sortOptions,
  positionValue,
  onPositionChange,
  positionCounts,
  testIdPrefix,
}: PlayerListFiltersProps<T>) {
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortMenuOpensUpward, setSortMenuOpensUpward] = useState(false);
  const sortRootRef = useRef<HTMLDivElement>(null);
  const sortMenuId = useId();
  const selectedSort = sortOptions.find((option) => option.value === sortValue) ?? sortOptions[0];
  const toggleSortMenu = () => {
    if (!sortMenuOpen) {
      const bounds = sortRootRef.current?.getBoundingClientRect();
      const estimatedMenuHeight = sortOptions.length * 41 + 8;
      setSortMenuOpensUpward(Boolean(bounds && window.innerHeight - bounds.bottom < estimatedMenuHeight));
    }
    setSortMenuOpen((open) => !open);
  };
  return <section className="player-list-filters" aria-label={ariaLabel}>
    <div className="draft-player-tools">
      <div className="draft-player-search">
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
        <input
          data-testid={testIdPrefix ? `${testIdPrefix}-search` : undefined}
          type="text"
          inputMode="search"
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={searchValue}
          maxLength={40}
          autoComplete="off"
          onChange={(event) => onSearchChange(event.target.value)}
        />
        {searchValue && <button type="button" aria-label="清空球员搜索" onClick={() => onSearchChange("")}>×</button>}
      </div>
      <div ref={sortRootRef} className="draft-player-sort" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSortMenuOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setSortMenuOpen(false); }}>
        <button
          type="button"
          className="draft-player-sort-trigger"
          data-testid={testIdPrefix ? `${testIdPrefix}-sort` : undefined}
          aria-label={`排序方式：${selectedSort.label}${selectedSort.direction}`}
          aria-expanded={sortMenuOpen}
          aria-controls={sortMenuId}
          onClick={toggleSortMenu}
        ><span>排序 · {selectedSort.label}</span><span aria-hidden="true">⌄</span></button>
        {sortMenuOpen && <div id={sortMenuId} className={`draft-player-sort-options${sortMenuOpensUpward ? " open-up" : ""}`} role="group" aria-label="选择排序方式">
          {sortOptions.map((option) => <button
            type="button"
            key={option.value}
            data-testid={testIdPrefix ? `${testIdPrefix}-sort-${option.value}` : undefined}
            aria-pressed={sortValue === option.value}
            onClick={() => { onSortChange(option.value); setSortMenuOpen(false); }}
          ><span>{option.label}</span><small>{option.direction}</small>{sortValue === option.value && <b aria-hidden="true">✓</b>}</button>)}
        </div>}
      </div>
    </div>
    <div className="draft-position-filter" role="group" aria-label="按球员位置筛选">
      {EXPANSION_POSITION_FILTERS.map((position) => <button
        type="button"
        key={position}
        data-testid={testIdPrefix ? `${testIdPrefix}-position-${position}` : undefined}
        className={positionValue === position ? "active" : ""}
        aria-pressed={positionValue === position}
        onClick={() => onPositionChange(position)}
      ><b>{position === "ALL" ? "全部" : position}</b><small>{positionCounts[position]}</small></button>)}
    </div>
  </section>;
}
