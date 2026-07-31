<script lang="ts">
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import Icon from "@iconify/svelte";
import { url } from "@utils/url-utils.ts";
import { onMount } from "svelte";
import type { SearchResult } from "@/global";

let keywordDesktop = "";
let keywordMobile = "";
let result: SearchResult[] = [];
let isSearching = false;
let pagefindLoaded = false;
let initialized = false;
let selectedIndex = -1;

// 搜索结果高亮：在标题中包住匹配词
const highlightText = (text: string, kw: string): string => {
	if (!kw || !text) return text;
	const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return text.replace(new RegExp(`(${escaped})`, "gi"), "<mark>$1</mark>");
};

// 搜索过滤器：分类/标签，来自 pagefind.filters()
type FilterField = "category" | "tag";
let filterOptions: Record<FilterField, string[]> = { category: [], tag: [] };
let activeFilters: Partial<Record<FilterField, Set<string>>> = {};

const buildPagefindFilters = () => {
	const filters: Record<string, string[]> = {};
	(activeFilters.category?.size || 0) > 0 &&
		(filters.category = [...activeFilters.category!]);
	(activeFilters.tag?.size || 0) > 0 && (filters.tag = [...activeFilters.tag!]);
	return filters;
};

const toggleFilter = (field: FilterField, value: string) => {
	if (!activeFilters[field]) activeFilters[field] = new Set();
	const set = activeFilters[field]!;
	if (set.has(value)) {
		set.delete(value);
		if (set.size === 0) delete activeFilters[field];
	} else {
		set.add(value);
	}
	// 触发重新搜索
	if (initialized) {
		if (keywordDesktop) search(keywordDesktop, true);
		if (keywordMobile) search(keywordMobile, false);
	}
};

const fakeResult: SearchResult[] = [
	{
		url: url("/"),
		meta: {
			title: "This Is a Fake Search Result",
		},
		excerpt:
			"Because the search cannot work in the <mark>dev</mark> environment.",
	},
	{
		url: url("/"),
		meta: {
			title: "If You Want to Test the Search",
		},
		excerpt: "Try running <mark>npm build && npm preview</mark> instead.",
	},
];

const togglePanel = () => {
	const panel = document.getElementById("search-panel");
	panel?.classList.toggle("float-panel-closed");
};

const setPanelVisibility = (show: boolean, isDesktop: boolean): void => {
	const panel = document.getElementById("search-panel");
	if (!panel || !isDesktop) return;

	if (show) {
		panel.classList.remove("float-panel-closed");
	} else {
		panel.classList.add("float-panel-closed");
	}
};

const search = async (keyword: string, isDesktop: boolean): Promise<void> => {
	if (!keyword) {
		setPanelVisibility(false, isDesktop);
		result = [];
		return;
	}

	if (!initialized) {
		return;
	}

	isSearching = true;

	try {
		let searchResults: SearchResult[] = [];

		if (import.meta.env.PROD && pagefindLoaded && window.pagefind) {
			const filters = buildPagefindFilters();
			const response = await window.pagefind.search(keyword, {
				filters: Object.keys(filters).length ? filters : undefined,
			});
			searchResults = await Promise.all(
				response.results.map((item) => item.data()),
			);
		} else if (import.meta.env.DEV) {
			searchResults = fakeResult;
		} else {
			searchResults = [];
			console.error("Pagefind is not available in production environment.");
		}
		searchResults = searchResults;
				result = searchResults;
				setPanelVisibility(result.length > 0, isDesktop);
				selectedIndex = -1;
			} catch (error) {
		console.error("Search error:", error);
		result = [];
		setPanelVisibility(false, isDesktop);
	} finally {
		isSearching = false;
	}
};

onMount(() => {
	const initializeSearch = () => {
		initialized = true;
		pagefindLoaded =
			typeof window !== "undefined" &&
			!!window.pagefind &&
			typeof window.pagefind.search === "function";
		console.log("Pagefind status on init:", pagefindLoaded);
		if (keywordDesktop) search(keywordDesktop, true);
		if (keywordMobile) search(keywordMobile, false);
	};

	// Ctrl/Cmd+K 唤起搜索：桌面聚焦输入框，移动端切换面板
		const onGlobalKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				const bar = document.getElementById("search-bar");
				const input = bar?.querySelector<HTMLInputElement>("input");
				if (bar && input && getComputedStyle(bar).display !== "none") {
					input.focus();
					input.select();
				} else {
					togglePanel();
				}
				return;
			}
			// Escape 关闭面板
			if (e.key === "Escape") {
				const panel = document.getElementById("search-panel");
				if (panel && !panel.classList.contains("float-panel-closed")) {
					panel.classList.add("float-panel-closed");
				}
			}
		};
	document.addEventListener("keydown", onGlobalKey);

	if (import.meta.env.DEV) {
		console.log(
			"Pagefind is not available in development mode. Using mock data.",
		);
		initializeSearch();
	} else {
		document.addEventListener("pagefindready", () => {
			console.log("Pagefind ready event received.");
			initializeSearch();
		});
		document.addEventListener("pagefindloaderror", () => {
			console.warn(
				"Pagefind load error event received. Search functionality will be limited.",
			);
			initializeSearch(); // Initialize with pagefindLoaded as false
		});

		// Load filter options once (category/tag chips)
		const loadFilters = () => {
			if (window.pagefind?.filters) {
				window.pagefind.filters().then((all: Record<string, Record<string, number>>) => {
					filterOptions.category = Object.keys(all.category ?? {});
					filterOptions.tag = Object.keys(all.tag ?? {});
				});
			}
		};
		if (window.pagefind) loadFilters();
		else document.addEventListener("pagefindready", loadFilters, { once: true });

		// Fallback in case events are not caught or pagefind is already loaded by the time this script runs
		setTimeout(() => {
			if (!initialized) {
				console.log("Fallback: Initializing search after timeout.");
				initializeSearch();
			}
		}, 2000); // Adjust timeout as needed
	}

	return () => {
		document.removeEventListener("keydown", onGlobalKey);
	};
});

$: if (initialized && keywordDesktop) {
	(async () => {
		await search(keywordDesktop, true);
	})();
}

$: if (initialized && keywordMobile) {
	(async () => {
		await search(keywordMobile, false);
	})();
}
</script>

<!-- search bar for desktop view -->
<div id="search-bar" class="group hidden lg:flex transition-all items-center h-11 mr-2 rounded-lg
      bg-black/[0.04] hover:bg-black/[0.06] focus-within:bg-black/[0.06]
      dark:bg-white/5 dark:hover:bg-white/10 dark:focus-within:bg-white/10
">
    <Icon icon="material-symbols:search" class="absolute text-[1.25rem] pointer-events-none ml-3 transition my-auto text-black/30 dark:text-white/30"></Icon>
    <input placeholder="find…" bind:value={keywordDesktop} on:focus={() => search(keywordDesktop, true)}
               class="transition-all pl-10 text-sm bg-transparent outline-0
             h-full w-40 active:w-60 focus:w-60 text-black/50 dark:text-white/50"
        >
    <kbd class="transition mr-2.5 pointer-events-none select-none text-[0.625rem] leading-none px-1.5 py-1 rounded-md border border-black/15 dark:border-white/20 text-black/35 dark:text-white/35 group-focus-within:opacity-0 group-focus-within:-translate-x-1">Ctrl K</kbd>
</div>

<!-- toggle btn for phone/tablet view -->
<button on:click={togglePanel} aria-label="Search Panel" id="search-switch"
        class="btn-plain scale-animation lg:!hidden rounded-lg w-11 h-11 active:scale-90">
    <Icon icon="material-symbols:search" class="text-[1.25rem]"></Icon>
</button>

<!-- search panel -->
<div id="search-panel" class="float-panel float-panel-closed search-panel absolute md:w-[30rem]
top-20 left-4 md:left-[unset] right-4 shadow-2xl rounded-2xl p-2">

    <!-- search bar inside panel for phone/tablet -->
    <div id="search-bar-inside" class="flex relative lg:hidden transition-all items-center h-11 rounded-xl
      bg-black/[0.04] hover:bg-black/[0.06] focus-within:bg-black/[0.06]
      dark:bg-white/5 dark:hover:bg-white/10 dark:focus-within:bg-white/10
  ">
        <Icon icon="material-symbols:search" class="absolute text-[1.25rem] pointer-events-none ml-3 transition my-auto text-black/30 dark:text-white/30"></Icon>
        <input placeholder="Search" bind:value={keywordMobile}
               class="pl-10 absolute inset-0 text-sm bg-transparent outline-0
               focus:w-60 text-black/50 dark:text-white/50"
        >
    </div>

    <div class="search-panel__status" aria-hidden="true">
        <span class="search-panel__status-left">
            <span class="search-panel__status-dot"></span>
            <span>query · pagefind</span>
        </span>
        <span>
            {isSearching ? "scanning…" : result.length ? `${result.length} hit(s)` : "idle"}
        </span>
    </div>

    <!-- filter chips: category + tag (loaded from pagefind.filters) -->
    {#if filterOptions.category.length || filterOptions.tag.length}
        <div class="search-panel__filters">
            {#if filterOptions.category.length}
                <div class="search-panel__filters-row">
                    <span class="search-panel__filters-label">分类</span>
                    <div class="flex flex-wrap gap-1.5">
                        {#each filterOptions.category as cat}
                            <button class:list={["search-panel__chip", { "search-panel__chip--active": activeFilters.category?.has(cat) }]}
                                    on:click={() => toggleFilter("category", cat)}>
                                {cat}
                            </button>
                        {/each}
                    </div>
                </div>
            {/if}
            {#if filterOptions.tag.length}
                <div class="search-panel__filters-row">
                    <span class="search-panel__filters-label">标签</span>
                    <div class="flex flex-wrap gap-1.5">
                        {#each filterOptions.tag as tag}
                            <button class:list={["search-panel__chip", { "search-panel__chip--active": activeFilters.tag?.has(tag) }]}
                                    on:click={() => toggleFilter("tag", tag)}>
                                {tag}
                            </button>
                        {/each}
                    </div>
                </div>
            {/if}
        </div>
    {/if}

    <!-- search results -->
        {#if result.length > 0}
            <div class="search-panel__results" on:keydown={(e) => {
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    selectedIndex = Math.min(selectedIndex + 1, result.length - 1);
                } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    selectedIndex = Math.max(selectedIndex - 1, -1);
                } else if (e.key === "Enter" && selectedIndex >= 0) {
                    e.preventDefault();
                    const el = document.querySelector(`.search-result-item[data-index="${selectedIndex}"]`);
                    (el as HTMLAnchorElement)?.click();
                }
            }}>
            {#each result as item, i}
                <a href={item.url}
                                   data-index={i}
                                   class:list={["search-result-item transition first-of-type:mt-2 lg:first-of-type:mt-0 group block rounded-xl px-4 py-3",
                                       { "!bg-[var(--toc-btn-hover)]": selectedIndex === i }]}
                                   on:mouseenter={() => { selectedIndex = i; }}
                                   class="hover:bg-[var(--btn-plain-bg-hover)] active:bg-[var(--btn-plain-bg-active)]"
                                   on:click={() => { setPanelVisibility(false, true); setTimeout(() => { keywordDesktop = ""; result = []; }, 300); }}
                                >
                                    <div class="transition text-90 font-bold group-hover:text-[var(--primary)]">
                                        {@html highlightText(item.meta.title, keywordDesktop || keywordMobile)}<Icon icon="fa6-solid:chevron-right" class="transition text-[0.75rem] translate-x-1 my-auto text-[var(--primary)]"></Icon>
                                    </div>
                                    <div class="transition text-sm text-50 mt-1 leading-relaxed">
                                        {@html item.excerpt}
                                    </div>
                                </a>
            {/each}
            </div>
        {:else if keywordDesktop || keywordMobile}
            <div class="search-panel__empty">
                <Icon icon="material-symbols:search-off" class="text-[2rem] text-black/20 dark:text-white/20"></Icon>
                <div class="text-sm text-50 mt-1">无匹配结果</div>
            </div>
        {/if}
</div>

<style>
  input:focus {
    outline: 0;
  }
  .search-panel {
    max-height: calc(100vh - 100px);
    overflow-y: auto;
  }
  .search-panel__results {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .search-panel__results:focus {
      outline: none;
    }
    .search-panel__empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 0;
      text-align: center;
    }
    .search-panel__filters {
      margin-top: 0.5rem;
      padding: 0.5rem 0.25rem 0.25rem;
      border-top: 1px dashed var(--line-divider);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .search-panel__filters-row {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
        }
        .search-panel__filters-label {
                  font-size: 0.75rem;
                  line-height: 1.8rem;
                  flex-shrink: 0;
                  color: rgba(0, 0, 0, 0.5);
                  opacity: 0.7;
                }
        /* 搜索面板 mark 标签统一 */
    .search-panel mark {
      background: color-mix(in oklch, var(--primary) 22%, transparent);
      color: var(--primary);
      border-radius: 0.15rem;
      padding: 0 0.15em;
    }
    /* 面板打开/关闭动画 */
    .float-panel {
      transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      opacity: 1;
      transform: translateY(0);
    }
    .float-panel-closed {
      opacity: 0;
      transform: translateY(-0.5rem);
      pointer-events: none;
    }
  </style>
