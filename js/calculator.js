(function () {
    "use strict";

    const TOTAL_POINTS = 34;
    const TRAINING_UNLOCK_POINTS = 6;
    const TALENTS_PARAM = "talents";
    const TALENT_CODE_LENGTH = 2;
    const SVG_NS = "http://www.w3.org/2000/svg";
    const DATA_LOCATIONS = getDataLocations();
    const ICON_FOLDER = "icons/";

    const treeGrid = document.getElementById("treeGrid");
    const detailsColumn = document.querySelector(".details-column");
    const pointsUsed = document.getElementById("pointsUsed");
    const mutagenSlotsUnlocked = document.getElementById("mutagenSlotsUnlocked");
    const detailIcon = document.getElementById("detailIcon");
    const detailTree = document.getElementById("detailTree");
    const detailTitle = document.getElementById("detailTitle");
    const detailDescription = document.getElementById("detailDescription");
    const detailRank = document.getElementById("detailRank");
    const detailStatus = document.getElementById("detailStatus");
    const resetAllButton = document.getElementById("resetAllButton");
    const talentTooltip = createTalentTooltip();
    const talentTooltipTitle = talentTooltip.querySelector(".talent-tooltip-title");
    const talentTooltipDescription = talentTooltip.querySelector(".talent-tooltip-description");
    let tooltipOwner = null;
    let pinnedTalentTooltipId = null;
    let lastPointerType = "";

    const state = {
        talents: [],
        byId: new Map(),
        points: new Map(),
        selectedId: null,
        hoveredId: null,
        message: "",
        messageFor: null,
        missingIconNames: new Set()
    };

    treeGrid.innerHTML = "<div class=\"tree-empty\">Loading talents...</div>";

    resetAllButton.addEventListener("click", resetAllTrees);
    document.addEventListener("pointerdown", handleDocumentPointerDown);

    loadTalentData().then(() => {});

    function fetchJson(url, label) {
        return fetch(url, { cache: "no-store" })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error(label + " returned " + response.status);
                }
                return response.json();
            });
    }

    async function loadTalentData() {
        let failures = [];

        for (let index = 0; index < DATA_LOCATIONS.length; index += 1) {
            const location = DATA_LOCATIONS[index];

            try {
                const results = await Promise.all([
                    fetchJson(location.talents, "Talent data"),
                    fetchJson(location.talentTrees, "Talent tree data")
                ]);
                initializeTalentData(results[0], results[1]);
                return;
            } catch (error) {
                failures.push(error);
            }
        }

        failures.forEach(function (error) {
            console.error(error);
        });

        if (window.location.protocol === "file:") {
            treeGrid.innerHTML = "<div class=\"load-error\">The talent data could not be loaded. Serve this folder over HTTP so the browser can read the JSON files.</div>";
            return;
        }

        treeGrid.innerHTML = "<div class=\"load-error\">The talent data could not be loaded.</div>";
    }

    function getDataLocations() {
        const locations = [
            {
                talents: "talents.json",
                talentTrees: "talenttrees.json"
            }
        ];

        if (document.currentScript && document.currentScript.src) {
            const scriptUrl = new URL(document.currentScript.src);
            locations.push({
                talents: new URL("../talents.json", scriptUrl).href,
                talentTrees: new URL("../talenttrees.json", scriptUrl).href
            });
        }

        if (window.location.protocol === "http:" || window.location.protocol === "https:") {
            locations.push({
                talents: new URL("/talents.json", window.location.origin).href,
                talentTrees: new URL("/talenttrees.json", window.location.origin).href
            });
        }

        return locations;
    }

    function initializeTalentData(talents, talentTrees) {
        if (!Array.isArray(talents) || !Array.isArray(talentTrees)) {
            throw new Error("Talent data files must contain JSON arrays.");
        }

        const treesById = new Map(talentTrees.map(function (tree) {
            return [tree.id, tree];
        }));

        talents.forEach(function (talent) {
            talent.tree = treesById.get(talent.treeId);
            if (!talent.tree) {
                throw new Error("Unknown talent tree: " + talent.treeId);
            }
            talent.requiredTalentIds = getRequiredTalentIds(talent);
            state.points.set(talent.id, 0);
        });

        state.talents = talents;
        state.byId = new Map(talents.map(function (talent) {
            return [talent.id, talent];
        }));

        if (!applyTalentsParamFromUrl()) {
            return;
        }
        render();
        installResizeObserver();
    }

    treeGrid.addEventListener("click", function (event) {
        const resetButton = event.target.closest(".tree-reset");
        if (resetButton) {
            resetTree(resetButton.dataset.treeId);
            return;
        }

        const node = event.target.closest(".talent-node");
        if (!node) {
            return;
        }

        const talentId = node.dataset.id;
        if (event.shiftKey) {
            removePoint(talentId);
        } else {
            addPoint(talentId);
        }

        refreshTalentTooltip(talentId, event, lastPointerType === "touch");
    });

    treeGrid.addEventListener("contextmenu", function (event) {
        const node = event.target.closest(".talent-node");
        if (!node) {
            return;
        }

        event.preventDefault();
        removePoint(node.dataset.id);
        refreshTalentTooltip(node.dataset.id, event, lastPointerType === "touch");
    });

    treeGrid.addEventListener("pointerover", function (event) {
        const node = event.target.closest(".talent-node");
        if (node) {
            state.hoveredId = node.dataset.id;
            renderDetails();
            showTalentTooltip(node.dataset.id, event, node, event.pointerType === "touch");
            return;
        }

        const resetButton = event.target.closest(".tree-reset");
        if (resetButton) {
            showDescriptionTooltip(resetButton.dataset.tooltipTitle, event, resetButton);
        }
    });

    treeGrid.addEventListener("pointermove", function (event) {
        if (talentTooltip.hidden || !tooltipOwner || !tooltipOwner.contains(event.target)) {
            return;
        }

        positionTalentTooltip(event);
    });

    treeGrid.addEventListener("pointerout", function (event) {
        const node = event.target.closest(".talent-node");
        if (!node || node.contains(event.relatedTarget)) {
            return;
        }

        if (state.hoveredId === node.dataset.id && pinnedTalentTooltipId !== node.dataset.id) {
            state.hoveredId = null;
            renderDetails();
        }
        if (tooltipOwner === node && pinnedTalentTooltipId !== node.dataset.id) {
            hideTalentTooltip();
        }
    });

    treeGrid.addEventListener("pointerout", function (event) {
        const resetButton = event.target.closest(".tree-reset");
        if (!resetButton || resetButton.contains(event.relatedTarget)) {
            return;
        }

        if (tooltipOwner === resetButton) {
            hideTalentTooltip();
        }
    });

    resetAllButton.addEventListener("pointerover", function (event) {
        showDescriptionTooltip(resetAllButton.dataset.tooltipTitle, event, resetAllButton);
    });

    resetAllButton.addEventListener("pointermove", function (event) {
        if (!talentTooltip.hidden) {
            positionTalentTooltip(event);
        }
    });

    resetAllButton.addEventListener("pointerout", function (event) {
        if (resetAllButton.contains(event.relatedTarget)) {
            return;
        }

        hideTalentTooltip();
    });

    function render() {
        treeGrid.textContent = "";

        getTreeGroups().forEach(function (group) {
            treeGrid.appendChild(renderTree(group));
        });

        pointsUsed.textContent = String(getRemainingPoints());
        mutagenSlotsUnlocked.textContent = String(getUnlockedMutagenSlots());
        resetAllButton.disabled = getSpentPoints() === 0;
        renderDetails();
        requestAnimationFrame(drawConnectors);
    }

    function renderTree(group) {
        const panel = document.createElement("section");
        panel.className = "tree-panel";
        panel.dataset.treeId = group.tree.id;
        panel.style.setProperty("--tree-color", group.tree.color);

        const heading = document.createElement("div");
        heading.className = "tree-heading";

        const resetButton = document.createElement("button");
        resetButton.type = "button";
        resetButton.className = "tree-reset";
        resetButton.dataset.treeId = group.tree.id;
        resetButton.dataset.tooltipTitle = "Reset " + group.tree.name;
        resetButton.textContent = "Reset";
        resetButton.disabled = getTreePoints(group.tree.id) === 0;

        const title = document.createElement("h2");
        title.textContent = group.tree.name;

        const count = document.createElement("span");
        count.className = "tree-points";
        count.textContent = getTreePoints(group.tree.id) + " points";

        heading.append(resetButton, title, count);

        const map = document.createElement("div");
        map.className = "tree-map";
        map.style.setProperty("--rows", String(getMaxRow(group.items)));

        const svg = document.createElementNS(SVG_NS, "svg");
        svg.classList.add("connector-layer");
        svg.setAttribute("aria-hidden", "true");
        map.appendChild(svg);

        group.items.forEach(function (talent) {
            map.appendChild(renderTalentNode(talent));
        });

        panel.append(heading, map);
        return panel;
    }

    function renderTalentNode(talent) {
        const rank = getRank(talent.id);
        const unlocked = isTalentUnlocked(talent);
        const hasMutagenSlot = talent.isMutagenSlot === true;
        const node = document.createElement("button");
        node.type = "button";
        node.className = "talent-node";
        node.dataset.id = talent.id;
        node.style.gridRow = String(talent.row);
        node.style.gridColumn = String(talent.column);
        node.setAttribute(
            "aria-label",
            talent.title + ", rank " + rank + " of " + talent.rank + (hasMutagenSlot ? ", mutagen slot" : "")
        );
        node.setAttribute("aria-pressed", rank > 0 ? "true" : "false");
        if (!unlocked) {
            node.classList.add("locked");
        }
        if (hasMutagenSlot) {
            node.classList.add("mutagen-slot");
        }
        if (hasMutagenSlot && rank > 0) {
            node.classList.add("mutagen-slot-active");
        }
        if (state.selectedId === talent.id) {
            node.classList.add("selected");
        }
        if (rank === 1) {
            node.classList.add("rank-1");
        }
        if (rank >= 2) {
            node.classList.add("rank-2");
        }
        if (getSpentPoints() >= TOTAL_POINTS && rank === 0) {
            node.classList.add("exhausted");
        }

        const icon = document.createElement("span");
        icon.className = "talent-icon";
        renderTalentIcon(icon, talent.icon);

        const badge = document.createElement("span");
        badge.className = "rank-badge";
        badge.textContent = rank + "/" + talent.rank;

        node.append(icon, badge);
        return node;
    }

    function renderDetails() {
        const talent = getActiveTalent();

        if (!talent) {
            renderTextIcon(detailIcon, "W2");
            detailTree.textContent = "None";
            detailTitle.textContent = "Choose a talent";
            detailDescription.textContent = "No talent selected.";
            detailRank.textContent = "0 / 0";
            detailStatus.textContent = "Advanced paths open at 6 Training points.";
            return;
        }

        const rank = getRank(talent.id);
        renderTalentIcon(detailIcon, talent.icon);
        detailTree.textContent = talent.tree.name;
        detailTitle.textContent = talent.title;
        renderTalentDescription(detailDescription, talent);
        detailRank.textContent = rank + " / " + talent.rank;
        detailStatus.textContent = getStatusText(talent);
    }

    function createTalentTooltip() {
        const tooltip = document.createElement("div");
        const title = document.createElement("strong");
        const description = document.createElement("p");

        tooltip.className = "talent-tooltip";
        tooltip.hidden = true;
        tooltip.setAttribute("role", "tooltip");
        title.className = "talent-tooltip-title";
        description.className = "talent-tooltip-description";

        tooltip.append(title, description);
        document.body.appendChild(tooltip);
        return tooltip;
    }

    function handleDocumentPointerDown(event) {
        lastPointerType = event.pointerType || "";

        if (!pinnedTalentTooltipId) {
            return;
        }

        const node = event.target.closest(".talent-node");
        if (node && node.dataset.id === pinnedTalentTooltipId) {
            return;
        }

        if (state.hoveredId === pinnedTalentTooltipId) {
            state.hoveredId = null;
            renderDetails();
        }
        hideTalentTooltip();
    }

    function refreshTalentTooltip(id, event, pinTooltip) {
        const renderedNode = getTalentNode(id);
        if (!renderedNode) {
            return;
        }

        state.hoveredId = id;
        renderDetails();
        showTalentTooltip(id, event, renderedNode, pinTooltip);
    }

    function showTalentTooltip(id, event, owner, pinTooltip) {
        const talent = state.byId.get(id);
        if (!talent) {
            hideTalentTooltip();
            return;
        }

        const tooltipOwnerElement = owner || event.target.closest(".talent-node");
        showTalentTextTooltip(talent, event, tooltipOwnerElement, pinTooltip ? talent.id : null);
    }

    function showTalentTextTooltip(talent, event, owner, pinnedTalentId) {
        talentTooltip.classList.remove("is-description-only");
        talentTooltipTitle.hidden = false;
        talentTooltipTitle.textContent = talent.title + " (" + getRank(talent.id) + "/" + talent.rank + ")";
        renderTalentDescription(talentTooltipDescription, talent);
        talentTooltipDescription.hidden = false;
        tooltipOwner = owner || null;
        pinnedTalentTooltipId = pinnedTalentId || null;
        talentTooltip.hidden = false;
        positionTalentTooltip(event);
    }

    function showDescriptionTooltip(text, event, owner) {
        talentTooltip.classList.add("is-description-only");
        talentTooltipTitle.textContent = "";
        talentTooltipTitle.hidden = true;
        talentTooltipDescription.textContent = text || "";
        talentTooltipDescription.hidden = false;
        tooltipOwner = owner || null;
        pinnedTalentTooltipId = null;
        talentTooltip.hidden = false;
        positionTalentTooltip(event);
    }

    function hideTalentTooltip() {
        talentTooltip.hidden = true;
        tooltipOwner = null;
        pinnedTalentTooltipId = null;
    }

    function positionTalentTooltip(event) {
        const offset = 16;
        const viewportPadding = 10;
        const tooltipRect = talentTooltip.getBoundingClientRect();
        let top = event.clientY + offset;

        if (top + tooltipRect.height + viewportPadding > window.innerHeight) {
            top = event.clientY - tooltipRect.height - offset;
        }

        top = Math.max(viewportPadding, top);
        const left = getTooltipHorizontalPosition(event, tooltipRect, top, offset, viewportPadding);

        talentTooltip.style.left = left + "px";
        talentTooltip.style.top = top + "px";
    }

    function getTooltipHorizontalPosition(event, tooltipRect, top, offset, viewportPadding) {
        const rightSideLeft = event.clientX + offset;
        const leftSideLeft = event.clientX - tooltipRect.width - offset;
        const rightSideRect = getPositionedRect(rightSideLeft, top, tooltipRect);
        const leftSideRect = getPositionedRect(leftSideLeft, top, tooltipRect);
        const sidebarRect = getDetailsColumnRect();

        if (sidebarRect
                && rectsOverlap(rightSideRect, sidebarRect)
                && leftSideLeft >= viewportPadding
                && !rectsOverlap(leftSideRect, sidebarRect)) {
            return leftSideLeft;
        }

        if (rightSideLeft + tooltipRect.width + viewportPadding > window.innerWidth
                && leftSideLeft >= viewportPadding) {
            return leftSideLeft;
        }

        return Math.max(
            viewportPadding,
            Math.min(rightSideLeft, window.innerWidth - tooltipRect.width - viewportPadding)
        );
    }

    function getDetailsColumnRect() {
        if (!detailsColumn) {
            return null;
        }

        const rect = detailsColumn.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return null;
        }

        return rect;
    }

    function getPositionedRect(left, top, sourceRect) {
        return {
            left: left,
            top: top,
            right: left + sourceRect.width,
            bottom: top + sourceRect.height
        };
    }

    function rectsOverlap(firstRect, secondRect) {
        return firstRect.left < secondRect.right
            && firstRect.right > secondRect.left
            && firstRect.top < secondRect.bottom
            && firstRect.bottom > secondRect.top;
    }

    function getTalentNode(id) {
        const nodes = treeGrid.querySelectorAll(".talent-node");
        for (let index = 0; index < nodes.length; index += 1) {
            if (nodes[index].dataset.id === id) {
                return nodes[index];
            }
        }

        return null;
    }

    function renderTalentIcon(container, iconName) {
        const normalizedIconName = String(iconName || "").trim();

        if (!normalizedIconName || state.missingIconNames.has(normalizedIconName)) {
            renderTextIcon(container, normalizedIconName);
            return;
        }

        container.textContent = "";

        const image = document.createElement("img");
        image.className = "talent-icon-image";
        image.src = ICON_FOLDER + encodeURIComponent(normalizedIconName) + ".webp";
        image.alt = "";
        image.decoding = "async";
        image.draggable = false;
        image.addEventListener("error", function () {
            state.missingIconNames.add(normalizedIconName);
            renderTextIcon(container, normalizedIconName);
        }, { once: true });

        container.appendChild(image);
    }

    function renderTextIcon(container, iconName) {
        container.textContent = iconName || "";
    }

    function addPoint(id) {
        const talent = state.byId.get(id);
        if (!talent) {
            return;
        }

        state.selectedId = id;
        if (!canAdd(talent)) {
            setMessage(id, getAddBlockedText(talent));
            render();
            return;
        }

        clearMessage();
        state.points.set(id, getRank(id) + 1);
        updateTalentsParamInUrl();
        render();
    }

    function removePoint(id) {
        const talent = state.byId.get(id);
        if (!talent) {
            return;
        }

        state.selectedId = id;
        if (!canRemove(talent)) {
            setMessage(id, getRemoveBlockedText(talent));
            render();
            return;
        }

        clearMessage();
        state.points.set(id, getRank(id) - 1);
        updateTalentsParamInUrl();
        render();
    }

    function resetTree(treeId) {
        if (treeId === "TRAINING") {
            resetAllTrees();
            return;
        }

        let changed = false;

        state.talents.forEach(function (talent) {
            if (talent.tree.id === treeId && getRank(talent.id) > 0) {
                state.points.set(talent.id, 0);
                changed = true;
            }
        });

        if (!changed) {
            return;
        }

        clearMessage();
        updateTalentsParamInUrl();
        render();
    }

    function resetAllTrees() {
        if (getSpentPoints() === 0) {
            return;
        }

        state.talents.forEach(function (talent) {
            state.points.set(talent.id, 0);
        });

        clearMessage();
        updateTalentsParamInUrl();
        render();
    }

    function canAdd(talent) {
        return isTalentUnlocked(talent)
            && getRank(talent.id) < talent.rank
            && getSpentPoints() < TOTAL_POINTS;
    }

    function canRemove(talent) {
        if (getRank(talent.id) <= 0) {
            return false;
        }

        if (getRank(talent.id) === 1 && hasPurchasedDependentsNeeding(talent.id)) {
            return false;
        }

        return !(talent.tree.id === "TRAINING"
            && getTrainingPoints() - 1 < TRAINING_UNLOCK_POINTS
            && getAdvancedPoints() > 0);


    }

    function isTalentUnlocked(talent) {
        if (getSpentPoints() >= TOTAL_POINTS && getRank(talent.id) === 0) {
            return false;
        }

        if (talent.tree.id !== "TRAINING" && getTrainingPoints() < TRAINING_UNLOCK_POINTS) {
            return false;
        }

        return hasNoRequirements(talent) || hasPurchasedRequirement(talent);
    }

    function getStatusText(talent) {
        if (state.message && state.messageFor === talent.id) {
            return state.message;
        }

        if (talent.tree.id !== "TRAINING" && getTrainingPoints() < TRAINING_UNLOCK_POINTS) {
            return "Requires 6 points in Training.";
        }

        if (!hasNoRequirements(talent) && !hasPurchasedRequirement(talent)) {
            return "Requires " + getRequirementText(talent) + ".";
        }

        if (getRank(talent.id) >= talent.rank) {
            return "Maxed out.";
        }

        if (getSpentPoints() >= TOTAL_POINTS) {
            return "No talent points remaining.";
        }

        return getRank(talent.id) > 0 ? "Rank 1 purchased." : "Available.";
    }

    function getTalentDescription(talent) {
        if (typeof talent.descriptionRank1 === "string" || typeof talent.descriptionRank2 === "string") {
            return "Rank 1:\n"
                + (talent.descriptionRank1 || "")
                + "\n\nRank 2:\n"
                + (talent.descriptionRank2 || "");
        }

        return talent.description || "";
    }

    function renderTalentDescription(container, talent) {
        container.textContent = "";

        if (typeof talent.descriptionRank1 !== "string" && typeof talent.descriptionRank2 !== "string") {
            container.textContent = getTalentDescription(talent);
            return;
        }

        const rank = getRank(talent.id);
        appendTalentRankDescription(container, 1, talent.descriptionRank1 || "", rank >= 1);
        appendTalentRankDescription(container, 2, talent.descriptionRank2 || "", rank >= 2);
    }

    function appendTalentRankDescription(container, rank, description, isUnlocked) {
        const section = document.createElement("span");
        const label = document.createElement("span");
        const text = document.createElement("span");

        section.className = "talent-description-rank";
        if (isUnlocked) {
            section.classList.add("is-unlocked");
        }

        label.className = "talent-description-rank-label";
        label.textContent = "Rank " + rank + ":";
        text.className = "talent-description-rank-text";
        text.textContent = description;

        section.append(label, text);
        container.appendChild(section);
    }

    function getAddBlockedText(talent) {
        if (talent.tree.id !== "TRAINING" && getTrainingPoints() < TRAINING_UNLOCK_POINTS) {
            return "Requires 6 points in Training.";
        }

        if (!hasNoRequirements(talent) && !hasPurchasedRequirement(talent)) {
            return "Requires " + getRequirementText(talent) + ".";
        }

        if (getRank(talent.id) >= talent.rank) {
            return "Maxed out.";
        }

        if (getSpentPoints() >= TOTAL_POINTS) {
            return "No talent points remaining.";
        }

        return "Unavailable.";
    }

    function getRemoveBlockedText(talent) {
        if (getRank(talent.id) <= 0) {
            return "No points assigned.";
        }

        if (getRank(talent.id) === 1 && hasPurchasedDependentsNeeding(talent.id)) {
            return "Remove dependent talents first.";
        }

        if (talent.tree.id === "TRAINING"
                && getTrainingPoints() - 1 < TRAINING_UNLOCK_POINTS
                && getAdvancedPoints() > 0) {
            return "Advanced talents require 6 Training points.";
        }

        return "Cannot remove this point.";
    }

    function drawConnectors() {
        document.querySelectorAll(".tree-panel").forEach(function (panel) {
            const treeId = panel.dataset.treeId;
            const map = panel.querySelector(".tree-map");
            const svg = panel.querySelector(".connector-layer");
            const mapRect = map.getBoundingClientRect();
            svg.textContent = "";

            state.talents
                .filter(function (talent) {
                    return talent.tree.id === treeId && talent.requiredTalentIds.length > 0;
                })
                .forEach(function (talent) {
                    talent.requiredTalentIds.forEach(function (requiredTalentId) {
                        const dependency = state.byId.get(requiredTalentId);
                        if (!dependency || dependency.tree.id !== treeId) {
                            return;
                        }

                        const from = map.querySelector("[data-id=\"" + dependency.id + "\"]");
                        const to = map.querySelector("[data-id=\"" + talent.id + "\"]");
                        if (!from || !to) {
                            return;
                        }

                        const fromRect = from.getBoundingClientRect();
                        const toRect = to.getBoundingClientRect();
                        const endpoints = getConnectorEndpoints(fromRect, toRect, mapRect);
                        if (!endpoints) {
                            return;
                        }

                        const line = document.createElementNS(SVG_NS, "line");
                        line.classList.add("connector-line");
                        if (getRank(talent.id) > 0 && getRank(dependency.id) > 0) {
                            line.classList.add("active");
                        }
                        if (!hasPurchasedRequirement(talent)) {
                            line.classList.add("locked");
                        }
                        line.setAttribute("x1", String(endpoints.x1));
                        line.setAttribute("y1", String(endpoints.y1));
                        line.setAttribute("x2", String(endpoints.x2));
                        line.setAttribute("y2", String(endpoints.y2));
                        svg.appendChild(line);
                    });
                });
        });
    }

    function getConnectorEndpoints(fromRect, toRect, mapRect) {
        const fromCenter = getRelativeCenter(fromRect, mapRect);
        const toCenter = getRelativeCenter(toRect, mapRect);
        const deltaX = toCenter.x - fromCenter.x;
        const deltaY = toCenter.y - fromCenter.y;
        const distance = Math.hypot(deltaX, deltaY);

        if (distance === 0) {
            return null;
        }

        const unitX = deltaX / distance;
        const unitY = deltaY / distance;
        const fromRadius = Math.min(fromRect.width, fromRect.height) / 2;
        const toRadius = Math.min(toRect.width, toRect.height) / 2;

        if (distance <= fromRadius + toRadius) {
            return null;
        }

        return {
            x1: fromCenter.x + unitX * fromRadius,
            y1: fromCenter.y + unitY * fromRadius,
            x2: toCenter.x - unitX * toRadius,
            y2: toCenter.y - unitY * toRadius
        };
    }

    function getRelativeCenter(rect, mapRect) {
        return {
            x: rect.left - mapRect.left + rect.width / 2,
            y: rect.top - mapRect.top + rect.height / 2
        };
    }

    function installResizeObserver() {
        if (!("ResizeObserver" in window)) {
            window.addEventListener("resize", function () {
                requestAnimationFrame(drawConnectors);
            });
            return;
        }

        const resizeObserver = new ResizeObserver(function () {
            requestAnimationFrame(drawConnectors);
        });
        resizeObserver.observe(treeGrid);
    }

    function getTreeGroups() {
        const groups = new Map();
        state.talents.forEach(function (talent) {
            if (!groups.has(talent.tree.id)) {
                groups.set(talent.tree.id, {
                    tree: talent.tree,
                    items: []
                });
            }
            groups.get(talent.tree.id).items.push(talent);
        });

        return Array.from(groups.values())
            .sort(function (left, right) {
                return left.tree.order - right.tree.order;
            })
            .map(function (group) {
                group.items.sort(function (left, right) {
                    return left.order - right.order;
                });
                return group;
            });
    }

    function getActiveTalent() {
        return state.byId.get(state.hoveredId) || state.byId.get(state.selectedId) || null;
    }

    function getRank(id) {
        return state.points.get(id) || 0;
    }

    function getSpentPoints() {
        return Array.from(state.points.values()).reduce(function (sum, rank) {
            return sum + rank;
        }, 0);
    }

    function getRemainingPoints() {
        return TOTAL_POINTS - getSpentPoints();
    }

    function getUnlockedMutagenSlots() {
        return state.talents.filter(function (talent) {
            return talent.isMutagenSlot === true && getRank(talent.id) > 0;
        }).length;
    }

    function getTreePoints(treeId) {
        return state.talents
            .filter(function (talent) {
                return talent.tree.id === treeId;
            })
            .reduce(function (sum, talent) {
                return sum + getRank(talent.id);
            }, 0);
    }

    function getTrainingPoints() {
        return getTreePoints("TRAINING");
    }

    function getAdvancedPoints() {
        return state.talents
            .filter(function (talent) {
                return talent.tree.id !== "TRAINING";
            })
            .reduce(function (sum, talent) {
                return sum + getRank(talent.id);
            }, 0);
    }

    function getRequiredTalentIds(talent) {
        if (Array.isArray(talent.requiredTalentIds)) {
            return talent.requiredTalentIds;
        }

        return talent.dependsOnId ? [talent.dependsOnId] : [];
    }

    function hasNoRequirements(talent) {
        return talent.requiredTalentIds.length === 0;
    }

    function hasPurchasedRequirement(talent) {
        return talent.requiredTalentIds.some(function (requiredTalentId) {
            return getRank(requiredTalentId) > 0;
        });
    }

    function getRequirementText(talent) {
        const titles = talent.requiredTalentIds.map(function (requiredTalentId) {
            const requiredTalent = state.byId.get(requiredTalentId);
            return requiredTalent ? requiredTalent.title : requiredTalentId;
        });

        if (titles.length <= 1) {
            return titles[0] || "another talent";
        }

        let requirements = titles[0];
        for (let i = 1; i < titles.length ; i++) {
            requirements += (i === titles.length - 1) ? " or " : ", ";
            requirements += titles[i];
        }

        return requirements;
    }

    function hasPurchasedDependentsNeeding(id) {
        return state.talents.some(function (talent) {
            if (getRank(talent.id) === 0 || talent.requiredTalentIds.indexOf(id) === -1) {
                return false;
            }

            return !talent.requiredTalentIds.some(function (requiredTalentId) {
                return requiredTalentId !== id && getRank(requiredTalentId) > 0;
            });
        });
    }

    function getMaxRow(talents) {
        return talents.reduce(function (max, talent) {
            return Math.max(max, talent.row);
        }, 1);
    }

    function setMessage(id, message) {
        state.messageFor = id;
        state.message = message;
    }

    function clearMessage() {
        state.messageFor = null;
        state.message = "";
    }

    function applyTalentsParamFromUrl() {
        const params = new URLSearchParams(window.location.search);
        if (!params.has(TALENTS_PARAM)) {
            return true;
        }

        const loadedPoints = parseTalentsParam(params.get(TALENTS_PARAM));
        if (!loadedPoints || !isBuildValid(loadedPoints)) {
            redirectToBaseUrl();
            return false;
        }

        state.points = loadedPoints;
        updateTalentsParamInUrl();
        return true;
    }

    function parseTalentsParam(value) {
        if (typeof value !== "string" || value.trim() === "") {
            return null;
        }

        return parseCompactTalentsParam(value);
    }

    function parseCompactTalentsParam(value) {
        const normalizedValue = value.trim().toUpperCase();
        const chunkLength = TALENT_CODE_LENGTH + 1;
        if (normalizedValue.length % chunkLength !== 0) {
            return null;
        }

        const codeIndex = getTalentCodeIndex();
        if (!codeIndex) {
            return null;
        }

        const points = createEmptyPointsMap();
        const seen = new Set();

        for (let index = 0; index < normalizedValue.length; index += chunkLength) {
            const code = normalizedValue.slice(index, index + TALENT_CODE_LENGTH);
            const rankToken = normalizedValue.slice(index + TALENT_CODE_LENGTH, index + chunkLength);
            const talent = codeIndex.get(code);

            if (!talent || seen.has(talent.id) || !/^\d$/.test(rankToken)) {
                return null;
            }

            const rank = Number(rankToken);
            if (rank < 1 || rank > talent.rank) {
                return null;
            }

            seen.add(talent.id);
            points.set(talent.id, rank);
        }

        return points;
    }

    function createEmptyPointsMap() {
        return new Map(state.talents.map(function (talent) {
            return [talent.id, 0];
        }));
    }

    function getTalentCodeIndex() {
        const codeIndex = new Map();

        for (const talent of state.talents) {
            const code = getTalentCode(talent);
            if (!code || codeIndex.has(code)) {
                return null;
            }
            codeIndex.set(code, talent);
        }

        return codeIndex;
    }

    function getTalentCode(talent) {
        const code = String(talent.icon || "").trim().toUpperCase();
        return code.length === TALENT_CODE_LENGTH ? code : null;
    }

    function isBuildValid(points) {
        if (getSpentPointsFrom(points) > TOTAL_POINTS) {
            return false;
        }

        if (getTrainingPointsFrom(points) < TRAINING_UNLOCK_POINTS && getAdvancedPointsFrom(points) > 0) {
            return false;
        }

        return state.talents.every(function (talent) {
            const rank = getRankFrom(points, talent.id);
            if (rank < 0 || rank > talent.rank) {
                return false;
            }

            if (rank === 0) {
                return true;
            }

            return talent.requiredTalentIds.length === 0
                || talent.requiredTalentIds.some(function (requiredTalentId) {
                    return getRankFrom(points, requiredTalentId) > 0;
                });
        });
    }

    function updateTalentsParamInUrl() {
        const value = encodeTalentsParam();
        const url = new URL(window.location.href);
        const params = [];

        url.searchParams.forEach(function (paramValue, key) {
            if (key !== TALENTS_PARAM) {
                params.push(encodeURIComponent(key) + "=" + encodeURIComponent(paramValue));
            }
        });

        if (value) {
            params.push(TALENTS_PARAM + "=" + value);
        }

        history.replaceState(null, "", url.pathname + (params.length > 0 ? "?" + params.join("&") : "") + url.hash);
    }

    function encodeTalentsParam() {
        return state.talents
            .filter(function (talent) {
                return getRank(talent.id) > 0;
            })
            .map(function (talent) {
                return getTalentCode(talent) + getRank(talent.id);
            })
            .join("");
    }

    function redirectToBaseUrl() {
        window.location.replace(window.location.pathname);
    }

    function getSpentPointsFrom(points) {
        return Array.from(points.values()).reduce(function (sum, rank) {
            return sum + rank;
        }, 0);
    }

    function getTrainingPointsFrom(points) {
        return state.talents
            .filter(function (talent) {
                return talent.tree.id === "TRAINING";
            })
            .reduce(function (sum, talent) {
                return sum + getRankFrom(points, talent.id);
            }, 0);
    }

    function getAdvancedPointsFrom(points) {
        return state.talents
            .filter(function (talent) {
                return talent.tree.id !== "TRAINING";
            })
            .reduce(function (sum, talent) {
                return sum + getRankFrom(points, talent.id);
            }, 0);
    }

    function getRankFrom(points, id) {
        return points.get(id) || 0;
    }
})();
