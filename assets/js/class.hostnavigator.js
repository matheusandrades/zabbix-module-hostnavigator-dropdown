class CHostNavigator {
    static ZBX_STYLE_CLASS = 'host-navigator';
    static ZBX_STYLE_LIMIT = 'host-navigator-limit';

    static GROUP_BY_HOST_GROUP = 0;
    static GROUP_BY_TAG_VALUE = 1;
    static GROUP_BY_SEVERITY = 2;

    static EVENT_HOST_SELECT = 'host.select';
    static EVENT_GROUP_TOGGLE = 'group.toggle';

    #config;
    #container;
    #navigation_tree = null;
    #nodes = [];
    #maintenances = {};
    #listeners = {};
    #selected_host_id = '';
    #searchInput;
    #datalist;

    constructor(config) {
        this.#config = config;
        this.#container = document.createElement('div');
        this.#container.classList.add(CHostNavigator.ZBX_STYLE_CLASS);
        this.#registerListeners();
    }

    setValue({hosts, maintenances, is_limit_exceeded}) {
        if (this.#container !== null) {
            this.#reset();
        }

        this.#maintenances = maintenances;
        this.#prepareNodesStructure(hosts);
        this.#prepareNodesProperties(this.#nodes);

        // Create search input element
        this.#searchInput = document.createElement('input');
        this.#searchInput.classList.add('host-navigator-search');
        this.#searchInput.placeholder = 'Search or select a host';
        this.#searchInput.setAttribute('list', 'hostsList');
        this.#searchInput.addEventListener('input', this.#onSearchInput.bind(this));
        this.#searchInput.addEventListener('change', this.#onSelectChange.bind(this));
        this.#searchInput.addEventListener('focus', this.#onFocus.bind(this));

        // Create datalist element for dropdown options
        this.#datalist = document.createElement('datalist');
        this.#datalist.id = 'hostsList';

        // Add options to the datalist
        this.#updateDropdownOptions(this.#nodes);

        this.#container.appendChild(this.#searchInput);
        this.#container.appendChild(this.#datalist);

        if (is_limit_exceeded) {
            this.#createLimit(hosts.length);
        }

        this.#activateListeners();
    }

    #updateDropdownOptions(nodes) {
        // Clear existing options
        this.#datalist.innerHTML = '';

        // Add filtered options to the datalist
        for (const node of nodes) {
            const option = document.createElement('option');
            option.value = node.name;
            option.dataset.id = node.id;
            this.#datalist.appendChild(option);
        }
    }

    #onSearchInput(event) {
        const searchValue = event.target.value.toLowerCase();
        const filteredNodes = this.#nodes.filter(node => node.name.toLowerCase().includes(searchValue));
        this.#updateDropdownOptions(filteredNodes);
    }

    #onSelectChange(event) {
        const selectedValue = event.target.value;
        const matchedNode = this.#nodes.find(node => node.name === selectedValue);

        if (matchedNode) {
            this.#selected_host_id = parseInt(matchedNode.id, 10);
            this.#container.dispatchEvent(new CustomEvent(CHostNavigator.EVENT_HOST_SELECT, {
                detail: {
                    hostid: this.#selected_host_id
                }
            }));

            // Ensure all options are available in the datalist without clearing the input
            this.#updateDropdownOptions(this.#nodes);
        }
    }

    #onFocus(event) {
        // Repopulate datalist with all options on focus
        this.#updateDropdownOptions(this.#nodes);
    }

    getContainer() {
        return this.#container;
    }

    destroy() {
        this.#container.remove();
    }

    #prepareNodesStructure(hosts) {
        if (this.#config.group_by.length > 0) {
            for (const host of hosts) {
                this.#createGroup(host);
            }

            this.#sortGroups(this.#nodes);

            if (this.#config.show_problems) {
                this.#calculateGroupsProblems(this.#nodes);
            }
        } else {
            this.#nodes = hosts;
        }
    }

    #prepareNodesProperties(nodes) {
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].children === undefined) {
                const properties = {
                    id: nodes[i].hostid,
                    name: nodes[i].name,
                    level: this.#config.group_by?.length || 0,
                    problem_count: nodes[i].problem_count
                };

                if (nodes[i].maintenanceid !== undefined) {
                    properties.maintenance = this.#maintenances[nodes[i].maintenanceid];
                }

                nodes[i] = properties;
            } else {
                nodes[i].is_open = this.#config.open_groups.includes(JSON.stringify(nodes[i].group_identifier));

                nodes[i].severity_filter = nodes[i].group_by.attribute === CHostNavigator.GROUP_BY_SEVERITY
                    ? nodes[i].severity_index
                    : undefined;

                this.#prepareNodesProperties(nodes[i].children);
            }
        }
    }

    #createGroup(host, level = 0, parent = null) {
        const attribute = this.#config.group_by[level];

        switch (attribute.attribute) {
            case CHostNavigator.GROUP_BY_HOST_GROUP:
                for (const hostgroup of host.hostgroups) {
                    const new_group = {
                        ...CHostNavigator.#getGroupTemplate(),
                        name: hostgroup.name,
                        group_by: {
                            attribute: CHostNavigator.GROUP_BY_HOST_GROUP,
                            name: t('Host group')
                        },
                        group_identifier: parent !== null
                            ? [...parent.group_identifier, hostgroup.groupid]
                            : [hostgroup.groupid],
                        level
                    };

                    this.#insertGroup(new_group, parent, level, host);
                }

                break;

            case CHostNavigator.GROUP_BY_TAG_VALUE:
                const matching_tags = host.tags.filter(tag => tag.tag === attribute.tag_name);

                if (matching_tags.length === 0) {
                    const new_group = {
                        ...CHostNavigator.#getGroupTemplate(),
                        name: t('Uncategorized'),
                        group_by: {
                            attribute: CHostNavigator.GROUP_BY_TAG_VALUE,
                            name: attribute.tag_name
                        },
                        group_identifier: parent !== null ? [...parent.group_identifier, null] : [null],
                        level,
                        is_uncategorized: true
                    };

                    this.#insertGroup(new_group, parent, level, host);
                } else {
                    for (const tag of matching_tags) {
                        const new_group = {
                            ...CHostNavigator.#getGroupTemplate(),
                            name: tag.value,
                            group_by: {
                                attribute: CHostNavigator.GROUP_BY_TAG_VALUE,
                                name: attribute.tag_name
                            },
                            group_identifier: parent !== null ? [...parent.group_identifier, tag.value] : [tag.value],
                            level
                        };

                        this.#insertGroup(new_group, parent, level, host);
                    }
                }

                break;

            case CHostNavigator.GROUP_BY_SEVERITY:
                const has_problems = host.problem_count.some(count => count > 0);

                if (!has_problems) {
                    const new_group = {
                        ...CHostNavigator.#getGroupTemplate(),
                        name: t('Uncategorized'),
                        group_by: {
                            attribute: CHostNavigator.GROUP_BY_SEVERITY,
                            name: t('Severity')
                        },
                        group_identifier: parent !== null ? [...parent.group_identifier, null] : [null],
                        level,
                        is_uncategorized: true,
                        severity_index: -1
                    };

                    this.#insertGroup(new_group, parent, level, host);
                } else {
                    for (let i = 0; i < host.problem_count.length; i++) {
                        if (host.problem_count[i] > 0) {
                            const new_group = {
                                ...CHostNavigator.#getGroupTemplate(),
                                name: this.#config.severities[i].label,
                                group_by: {
                                    attribute: CHostNavigator.GROUP_BY_SEVERITY,
                                    name: t('Severity')
                                },
                                group_identifier: parent !== null ? [...parent.group_identifier, i] : [i],
                                level,
                                severity_index: i
                            };

                            this.#insertGroup(new_group, parent, level, host);
                        }
                    }
                }

                break;
        }
    }

    static #getGroupTemplate() {
        return {
            name: '',
            group_by: {},
            group_identifier: [],
            level: 0,
            is_uncategorized: false,
            problem_count: [0, 0, 0, 0, 0, 0],
            children: [],
            is_open: false
        };
    }

    #insertGroup(new_group, parent, level, host) {
        const root = parent?.children || this.#nodes;
        const same_group = root.find(group => group.name === new_group.name);

        if (same_group !== undefined) {
            new_group = same_group;
        } else {
            root.push(new_group);
        }

        if (level === this.#config.group_by.length - 1) {
            if (!new_group.children.some(child => child.hostid === host.hostid)) {
                new_group.children.push(host);
            }
        } else {
            this.#createGroup(host, ++level, new_group);
        }
    }

    #sortGroups(groups) {
        if (groups[0].group_by.attribute === CHostNavigator.GROUP_BY_SEVERITY) {
            groups.sort((a, b) => b.severity_index - a.severity_index);
        } else {
            groups.sort((a, b) => {
                if (a.is_uncategorized) {
                    return 1;
                }
                if (b.is_uncategorized) {
                    return -1;
                }

                return a.name.localeCompare(b.name);
            });
        }

        for (const group of groups) {
            if (group.children?.length > 0 && group.level < this.#config.group_by.length - 1) {
                this.#sortGroups(group.children);
            }
        }
    }

    #calculateGroupsProblems(nodes, parent = null) {
        let hosts_problems = {};

        for (const node of nodes) {
            if (node.children?.length > 0) {
                hosts_problems = {...hosts_problems, ...this.#calculateGroupsProblems(node.children, node)};
            } else {
                hosts_problems[node.hostid] = node.problem_count;
            }
        }

        if (parent !== null) {
            for (const problem_count of Object.values(hosts_problems)) {
                for (let i = 0; i < problem_count.length; i++) {
                    parent.problem_count[i] += problem_count[i];
                }
            }
        }

        return hosts_problems;
    }

    #createLimit(limit) {
        const element = document.createElement('div');
        element.classList.add(CHostNavigator.ZBX_STYLE_LIMIT);
        element.innerText = t('%1$d of %1$d+ hosts are shown').replaceAll('%1$d', limit.toString());

        this.#container.appendChild(element);
    }

    #registerListeners() {
        this.#listeners = {
            hostSelect: e => {
                this.#selected_host_id = e.detail.hostid;
                console.log('Host selected:', this.#selected_host_id);  // Log para depuração

                this.#container.dispatchEvent(new CustomEvent(CHostNavigator.EVENT_HOST_SELECT, {
                    detail: {
                        hostid: this.#selected_host_id  // Certifique-se de que o hostid seja numérico
                    }
                }));
            },

            groupToggle: e => {
                const selected_group_identifier = e.detail.group_identifier;

                if (e.detail.is_open) {
                    this.#config.open_groups.push(JSON.stringify(selected_group_identifier));
                } else {
                    for (let i = 0; i < this.#config.open_groups.length; i++) {
                        const open_group_identifier = JSON.parse(this.#config.open_groups[i]);

                        if (open_group_identifier.length >= selected_group_identifier.length) {
                            let is_subgroup = true;

                            for (let j = 0; j < selected_group_identifier.length; j++) {
                                if (open_group_identifier[j] !== selected_group_identifier[j]) {
                                    is_subgroup = false;
                                    break;
                                }
                            }

                            if (is_subgroup) {
                                this.#config.open_groups.splice(i, 1);
                                i--;
                            }
                        }
                    }
                }

                this.#container.dispatchEvent(new CustomEvent(CHostNavigator.EVENT_GROUP_TOGGLE, {
                    detail: {
                        group_identifier: e.detail.group_identifier,
                        is_open: e.detail.is_open
                    }
                }));
            }
        };
    }

    #activateListeners() {
        // No activation needed for the select dropdown
    }

    #reset() {
        this.#container.innerHTML = '';
        this.#navigation_tree = null;
        this.#nodes = [];
        this.#maintenances = {};
    }
}

