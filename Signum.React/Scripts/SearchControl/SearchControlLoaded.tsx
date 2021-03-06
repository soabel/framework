﻿import * as React from 'react'
import { DropdownButton, MenuItem, OverlayTrigger, Tooltip } from 'react-bootstrap'
import { Dic, DomUtils, classes } from '../Globals'
import * as Finder from '../Finder'
import { CellFormatter, EntityFormatter } from '../Finder'
import {
    ResultTable, ResultRow, FindOptionsParsed, FindOptions, FilterOption, FilterOptionParsed, QueryDescription, ColumnOption, ColumnOptionParsed, ColumnOptionsMode, ColumnDescription,
    toQueryToken, Pagination, PaginationMode, OrderType, OrderOption, OrderOptionParsed, SubTokensOptions, filterOperations, QueryToken, QueryRequest
} from '../FindOptions'
import { SearchMessage, JavascriptMessage, Lite, liteKey, Entity, is, isEntity, isLite, toLite, ModifiableEntity } from '../Signum.Entities'
import { getTypeInfos, getTypeInfo, TypeReference, IsByAll, getQueryKey, TypeInfo, EntityData, QueryKey, PseudoType, isTypeModel } from '../Reflection'
import * as Navigator from '../Navigator'
import { AbortableRequest } from '../Services'
import * as Constructor from '../Constructor'
import PaginationSelector from './PaginationSelector'
import FilterBuilder from './FilterBuilder'
import ColumnEditor from './ColumnEditor'
import MultipliedMessage from './MultipliedMessage'
import { renderContextualItems, ContextualItemsContext, MarkedRowsDictionary, MarkedRow } from './ContextualItems'
import ContextMenu from './ContextMenu'
import { ContextMenuPosition } from './ContextMenu'
import SelectorModal from '../SelectorModal'
import { ISimpleFilterBuilder } from './SearchControl'

require("./Search.css");

export interface SearchControlLoadedProps {
    allowSelection?: boolean;
    findOptions: FindOptionsParsed;
    queryDescription: QueryDescription;
    querySettings: Finder.QuerySettings;
    showContextMenu?: boolean | "Basic";
    onDoubleClick?: (e: React.MouseEvent<any>, row: ResultRow) => void;
    formatters?: { [columnName: string]: CellFormatter };
    rowAttributes?: (row: ResultRow, columns: string[]) => React.HTMLAttributes<HTMLTableRowElement> | undefined;
    entityFormatter?: EntityFormatter;
    onSelectionChanged?: (entity: Lite<Entity>[]) => void;
    onFiltersChanged?: (filters: FilterOptionParsed[]) => void;
    onSearch?: (fo: FindOptionsParsed) => void;
    onResult?: (table: ResultTable) => void;
    hideButtonBar?: boolean;
    hideFullScreenButton?: boolean;
    showBarExtension?: boolean;
    largeToolbarButtons?: boolean;
    avoidAutoRefresh?: boolean;
    extraButtons?: (searchControl: SearchControlLoaded) => React.ReactNode
    onCreate?: () => Promise<void>;
    getViewPromise?: (e: ModifiableEntity) => Navigator.ViewPromise<ModifiableEntity>;
}

export interface SearchControlLoadedState {
    resultTable?: ResultTable;
    simpleFilterBuilder?: React.ReactElement<any>;
    selectedRows?: ResultRow[];
    markedRows?: MarkedRowsDictionary;

    searchCount?: number;
    dragColumnIndex?: number,
    dropBorderIndex?: number,

    currentMenuItems?: React.ReactElement<any>[];

    contextualMenu?: {
        position: ContextMenuPosition;
        columnIndex: number | null;
        columnOffset?: number;
        rowIndex: number | null;
    };

    editingColumn?: ColumnOptionParsed;
    lastToken?: QueryToken;
}


export default class SearchControlLoaded extends React.Component<SearchControlLoadedProps, SearchControlLoadedState>{

    constructor(props: SearchControlLoadedProps) {
        super(props);
        this.state = {};
    }

    componentWillMount() {

        const fo = this.props.findOptions;
        const qs = Finder.getSettings(fo.queryKey);
        const qd = this.props.queryDescription;

        const sfb = qs && qs.simpleFilterBuilder && qs.simpleFilterBuilder(qd, fo.filterOptions);

        if (sfb) {
            fo.showFilters = false;

            this.setState({
                simpleFilterBuilder: sfb
            });
        }

        if (fo.searchOnLoad)
            this.doSearch().done();
    }

    componentWillUnmount() {
        this.abortableSearch.abort();
    }


    entityColumn(): ColumnDescription {
        return this.props.queryDescription.columns["Entity"];
    }

    entityColumnTypeInfos(): TypeInfo[] {
        return getTypeInfos(this.entityColumn().type);
    }

    canFilter() {
        const fo = this.props.findOptions;
        return fo.showHeader && (fo.showFilterButton || fo.showFilters)
    }


    getQueryRequest(): QueryRequest {
        const fo = this.props.findOptions;
        const qs = this.props.querySettings;

        return {
            queryKey: fo.queryKey,
            filters: fo.filterOptions.filter(a => a.token != undefined && a.token.filterType != undefined && a.operation != undefined).map(fo => ({ token: fo.token!.fullKey, operation: fo.operation!, value: fo.value })),
            columns: fo.columnOptions.filter(a => a.token != undefined).map(co => ({ token: co.token!.fullKey, displayName: co.displayName! }))
                .concat((qs && qs.hiddenColumns || []).map(co => ({ token: co.columnName, displayName: "" }))),
            orders: fo.orderOptions.filter(a => a.token != undefined).map(oo => ({ token: oo.token.fullKey, orderType: oo.orderType })),
            pagination: fo.pagination,
        };
    }

    // MAIN
    doSearchPage1() {
        const fo = this.props.findOptions;

        if (fo.pagination.mode == "Paginate")
            fo.pagination.currentPage = 1;

        this.doSearch().done();
    };


    abortableSearch = new AbortableRequest((abortController, request: QueryRequest) => Finder.API.executeQuery(request, abortController)); 

    doSearch(): Promise<void> {
        return this.getFindOptionsWithSFB().then(fop => {
            if (this.props.onSearch)
                this.props.onSearch(fop);

            this.setState({ editingColumn: undefined });
            return this.abortableSearch.getData(this.getQueryRequest()).then(rt => {
                this.setState({
                    resultTable: rt,
                    selectedRows: [],
                    currentMenuItems: undefined,
                    markedRows: undefined,
                    searchCount: (this.state.searchCount || 0) + 1
                });
                if (this.props.onResult)
                    this.props.onResult(rt);

                this.notifySelectedRowsChanged();
                this.forceUpdate();
            });
        });
    }

    notifySelectedRowsChanged() {
        if (this.props.onSelectionChanged)
            this.props.onSelectionChanged(this.state.selectedRows!.map(a => a.entity));
    }


    simpleFilterBuilderInstance?: ISimpleFilterBuilder;

    getFindOptionsWithSFB(): Promise<FindOptionsParsed> {

        const fo = this.props.findOptions;
        const qd = this.props.queryDescription;

        if (this.simpleFilterBuilderInstance == undefined)
            return Promise.resolve(fo);

        if (!this.simpleFilterBuilderInstance.getFilters)
            throw new Error("The simple filter builder should have a method with signature: 'getFilters(): FilterOption[]'");

        var filters = this.simpleFilterBuilderInstance.getFilters();

        return Finder.parseFilterOptions(filters, qd).then(fos => {
            fo.filterOptions = fos;

            return fo;
        });
    }


    handlePagination = (p: Pagination) => {
        this.props.findOptions.pagination = p;
        this.setState({ resultTable: undefined });

        if (this.props.findOptions.pagination.mode != "All")
            this.doSearch().done();
    }


    handleOnContextMenu = (event: React.MouseEvent<any>) => {

        event.preventDefault();
        event.stopPropagation();

        const td = DomUtils.closest(event.target as HTMLElement, "td, th") !;
        const columnIndex = td.getAttribute("data-column-index") ? parseInt(td.getAttribute("data-column-index") !) : null;


        const tr = td.parentNode as HTMLElement;
        const rowIndex = tr.getAttribute("data-row-index") ? parseInt(tr.getAttribute("data-row-index") !) : null;

        this.setState({
            contextualMenu: {
                position: ContextMenu.getPosition(event, this.refs["container"] as HTMLElement),
                columnIndex,
                rowIndex,
                columnOffset: td.tagName == "TH" ? this.getOffset(event.pageX, td.getBoundingClientRect(), Number.MAX_VALUE) : undefined
            }
        });

        if (rowIndex != undefined) {
            const row = this.state.resultTable!.rows[rowIndex];
            if (!this.state.selectedRows!.contains(row)) {
                this.setState({
                    selectedRows: [row],
                    currentMenuItems: undefined
                }, () => {
                    this.loadMenuItems();
                });
            }

            if (this.state.currentMenuItems == undefined)
                this.loadMenuItems();
        }
    }


    handleColumnChanged = (token: QueryToken) => {
        this.setState({ lastToken: token });
    }

    handleColumnClose = () => {
        this.setState({ editingColumn: undefined });
    }

    handleFilterTokenChanged = (token: QueryToken) => {
        this.setState({ lastToken: token });
    }


    handleFiltersChanged = () => {
        if (this.props.onFiltersChanged)
            this.props.onFiltersChanged(this.props.findOptions.filterOptions);
    }

    handleFiltersKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.keyCode == 13)
            this.doSearchPage1();
    }


    render() {

        var fo = this.props.findOptions;
        var qd = this.props.queryDescription;

        const sfb = this.state.simpleFilterBuilder &&
            React.cloneElement(this.state.simpleFilterBuilder, { ref: (e: ISimpleFilterBuilder) => { this.simpleFilterBuilderInstance = e } });

        return (
            <div className="sf-search-control SF-control-container" ref="container"
                data-search-count={this.state.searchCount}
                data-query-key={fo.queryKey}>
                {fo.showHeader &&
                    <div onKeyUp={this.handleFiltersKeyUp}>
                        {
                            fo.showFilters ? <FilterBuilder
                                queryDescription={qd}
                                filterOptions={fo.filterOptions}
                                lastToken={this.state.lastToken}
                                subTokensOptions={SubTokensOptions.CanAnyAll | SubTokensOptions.CanElement}
                                onTokenChanged={this.handleFilterTokenChanged}
                                onFiltersChanged={this.handleFiltersChanged} /> :
                                sfb && <div className="simple-filter-builder">{sfb}</div>
                        }
                    </div>
                }
                {fo.showHeader && this.renderToolBar()}
                {<MultipliedMessage findOptions={fo} mainType={this.entityColumn().type} />}
                {this.state.editingColumn && <ColumnEditor
                    columnOption={this.state.editingColumn}
                    onChange={this.handleColumnChanged}
                    queryDescription={qd}
                    subTokensOptions={SubTokensOptions.CanElement}
                    close={this.handleColumnClose} />}
                <div className="sf-search-results-container table-responsive" >
                    <table className="sf-search-results table table-hover table-condensed" onContextMenu={this.props.showContextMenu != false ? this.handleOnContextMenu : undefined} >
                        <thead>
                            {this.renderHeaders()}
                        </thead>
                        <tbody>
                            {this.renderRows()}
                        </tbody>
                    </table>
                </div>
                {fo.showFooter && <PaginationSelector pagination={fo.pagination} onPagination={this.handlePagination} resultTable={this.state.resultTable} />}
                {this.state.contextualMenu && this.renderContextualMenu()}
            </div>
        );
    }


    // TOOLBAR
    handleToggleFilters = () => {
        this.getFindOptionsWithSFB().then(() => {
            this.simpleFilterBuilderInstance = undefined;
            this.props.findOptions.showFilters = !this.props.findOptions.showFilters;
            this.setState({ simpleFilterBuilder: undefined });
        }).done();
    }

    handleSearchClick = (ev: React.MouseEvent<any>) => {
        ev.preventDefault();

        this.doSearchPage1();

    };


    renderToolBar() {

        const fo = this.props.findOptions;
        return (
            <div className={classes("sf-query-button-bar btn-toolbar", !this.props.largeToolbarButtons && "btn-toolbar-small")}>
                {fo.showFilterButton && <a
                    className={"sf-query-button sf-filters-header btn btn-default" + (fo.showFilters ? " active" : "")}
                    onClick={this.handleToggleFilters}
                    title={fo.showFilters ? JavascriptMessage.hideFilters.niceToString() : JavascriptMessage.showFilters.niceToString()}><span className="glyphicon glyphicon glyphicon-filter"></span></a >}
                <button className={classes("sf-query-button sf-search btn", fo.pagination.mode == "All" ? "btn-danger" : "btn-primary")} onClick={this.handleSearchClick}>{SearchMessage.Search.niceToString()} </button>
                {fo.create && <a className="sf-query-button btn btn-default sf-search-button sf-create" title={this.createTitle()} onClick={this.handleCreate}>
                    <span className="glyphicon glyphicon-plus sf-create"></span>
                </a>}
                {this.props.showContextMenu != false && this.renderSelecterButton()}
                {!this.props.hideButtonBar && Finder.ButtonBarQuery.getButtonBarElements({ findOptions: fo, searchControl: this }).map((a, i) => React.cloneElement(a, { key: i }))}
                {!this.props.hideFullScreenButton &&
                    <a className="sf-query-button btn btn-default" href="#" onClick={this.handleFullScreenClick} >
                        <span className="glyphicon glyphicon-new-window"></span>
                    </a>}
                {this.props.extraButtons && this.props.extraButtons(this)}
            </div>
        );
    }


    chooseType(): Promise<string | undefined> {

        const tis = getTypeInfos(this.props.queryDescription.columns["Entity"].type)
            .filter(ti => Navigator.isCreable(ti, false, true));

        return SelectorModal.chooseType(tis)
            .then(ti => ti ? ti.name : undefined);
    }

    handleCreate = (ev: React.MouseEvent<any>) => {

        if (!this.props.findOptions.create)
            return;

        const onCreate = this.props.onCreate;

        if (onCreate)
            onCreate().done();
        else {
        const isWindowsOpen = ev.button == 1 || ev.ctrlKey;

        this.chooseType().then(tn => {
            if (tn == undefined)
                return;

            var s = Navigator.getSettings(tn);

            if (isWindowsOpen || (s != null && s.avoidPopup)) {
                window.open(Navigator.createRoute(tn));
            } else {
                Constructor.construct(tn).then(e => {
                    if (e == undefined)
                        return;

                    Finder.setFilters(e.entity as Entity, this.props.findOptions.filterOptions)
                        .then(() => Navigator.navigate(e!, { getViewPromise: this.props.getViewPromise }))
                        .then(() => this.props.avoidAutoRefresh ? undefined : this.doSearch())
                        .done();
                }).done();
            }
        }).done();
    }
    }

    handleFullScreenClick = (ev: React.MouseEvent<any>) => {

        ev.preventDefault();

        var findOptions = Finder.toFindOptions(this.props.findOptions, this.props.queryDescription);

        const path = Finder.findOptionsPath(findOptions);

        if (ev.ctrlKey || ev.button == 1)
            window.open(path);
        else
            Navigator.history.push(path);
    };
    
    createTitle() {

        const tis = this.entityColumnTypeInfos();

        const types = tis.map(ti => ti.niceName).join(", ");
        const gender = tis.first().gender;

        return SearchMessage.CreateNew0_G.niceToString().forGenderAndNumber(gender).formatWith(types);
    }

    getSelectedEntities(): Lite<Entity>[] {
        return this.state.selectedRows!.map(a => a.entity);
    }

    // SELECT BUTTON

    handleSelectedToggle = (isOpen: boolean) => {

        if (isOpen && this.state.currentMenuItems == undefined)
            this.loadMenuItems();
    }

    loadMenuItems() {
        if (this.props.showContextMenu == "Basic")
            this.setState({ currentMenuItems: [] });
        else {
            const options: ContextualItemsContext<Entity> = {
                lites: this.getSelectedEntities(),
                queryDescription: this.props.queryDescription,
                markRows: this.markRows,
                searchControl: this,
            };

            renderContextualItems(options)
                .then(menuItems => this.setState({ currentMenuItems: menuItems }))
                .done();
        }
    }

    markRows = (dic: MarkedRowsDictionary) => {
        var promise = this.props.avoidAutoRefresh ? Promise.resolve(undefined) :
            this.doSearch();

        promise.then(() => this.setState({ markedRows: { ...this.state.markedRows, ...dic } })).done();

    }

    renderSelecterButton() {

        if (this.state.selectedRows == undefined)
            return null;

        const title = JavascriptMessage.Selected.niceToString() + " (" + this.state.selectedRows!.length + ")";

        return (
            <DropdownButton id="selectedButton" className="sf-query-button sf-tm-selected" title={title}
                onToggle={this.handleSelectedToggle}
                disabled={this.state.selectedRows!.length == 0}>
                {this.state.currentMenuItems == undefined ? <MenuItem className="sf-tm-selected-loading">{JavascriptMessage.loading.niceToString()}</MenuItem> :
                    this.state.currentMenuItems.length == 0 ? <MenuItem className="sf-search-ctxitem-no-results">{JavascriptMessage.noActionsFound.niceToString()}</MenuItem> :
                        this.state.currentMenuItems.map((e, i) => React.cloneElement(e, { key: i }))}
            </DropdownButton>
        );
    }

    // CONTEXT MENU

    handleContextOnHide = () => {
        this.setState({ contextualMenu: undefined });
    }


    handleQuickFilter = () => {
        const cm = this.state.contextualMenu!;
        const fo = this.props.findOptions;

        const token = fo.columnOptions[cm.columnIndex!].token;

        const fops = token ? filterOperations[token.filterType as any] : undefined;

        const rt = this.state.resultTable!;

        const resultColumnIndex = token == null ? -1 : rt.columns.indexOf(token.fullKey);

        fo.filterOptions.push({
            token: token,
            operation: fops && fops.firstOrNull() || undefined,
            value: cm.rowIndex == undefined || resultColumnIndex == -1 ? undefined : rt.rows[cm.rowIndex].columns[resultColumnIndex],
            frozen: false
        });

        if (!fo.showFilters)
            fo.showFilters = true;

        this.handleFiltersChanged();

        this.forceUpdate();
    }

    handleInsertColumn = () => {

        const token = withoutAllAny(this.state.lastToken);

        const newColumn: ColumnOptionParsed = {
            token: token,
            displayName: token && token.niceName,
        };

        const cm = this.state.contextualMenu!;
        this.setState({ editingColumn: newColumn });
        this.props.findOptions.columnOptions.insertAt(cm.columnIndex! + cm.columnOffset!, newColumn);

        this.forceUpdate();
    }

    handleEditColumn = () => {

        const cm = this.state.contextualMenu!;
        const fo = this.props.findOptions;
        this.setState({ editingColumn: fo.columnOptions[cm.columnIndex!] });

        this.forceUpdate();
    }

    handleRemoveColumn = () => {
        const s = this.state;
        const cm = this.state.contextualMenu!;
        const fo = this.props.findOptions;
        const col = fo.columnOptions[cm.columnIndex!];
        fo.columnOptions.removeAt(cm.columnIndex!);

        this.setState({ editingColumn: undefined });
    }

    renderContextualMenu() {

        const cm = this.state.contextualMenu!;
        const fo = this.props.findOptions;

        const menuItems: React.ReactElement<any>[] = [];
        if (this.canFilter() && cm.columnIndex != undefined)
            menuItems.push(<MenuItem className="sf-quickfilter-header" onClick={this.handleQuickFilter}>{JavascriptMessage.addFilter.niceToString()}</MenuItem>);

        if (cm.rowIndex == undefined || fo.allowChangeColumns) {

            if (menuItems.length)
                menuItems.push(<MenuItem divider />);

            menuItems.push(<MenuItem className="sf-insert-header" onClick={this.handleInsertColumn}>{JavascriptMessage.insertColumn.niceToString()}</MenuItem>);
            menuItems.push(<MenuItem className="sf-edit-header" onClick={this.handleEditColumn}>{JavascriptMessage.editColumn.niceToString()}</MenuItem>);
            menuItems.push(<MenuItem className="sf-remove-header" onClick={this.handleRemoveColumn}>{JavascriptMessage.removeColumn.niceToString()}</MenuItem>);
        }

        if (cm.rowIndex != undefined) {

            if (this.state.currentMenuItems == undefined) {
                menuItems.push(<MenuItem header>{JavascriptMessage.loading.niceToString()}</MenuItem>);
            } else {
                if (menuItems.length && this.state.currentMenuItems.length)
                    menuItems.push(<MenuItem divider />);

                menuItems.splice(menuItems.length, 0, ...this.state.currentMenuItems);
            }
        }

        return (
            <ContextMenu position={cm.position} onHide={this.handleContextOnHide}>
                {menuItems.map((e, i) => React.cloneElement(e, { key: i }))}
            </ContextMenu>
        );
    }

    //SELECTED ROWS

    allSelected() {
        return this.state.resultTable != undefined && this.state.resultTable.rows.length != 0 && this.state.resultTable.rows.length == this.state.selectedRows!.length;
    }

    handleToggleAll = () => {

        if (!this.state.resultTable)
            return;

        this.setState({ selectedRows: !this.allSelected() ? this.state.resultTable!.rows.clone() : [] }, () => {
            this.notifySelectedRowsChanged()
        });
    }

    handleHeaderClick = (e: React.MouseEvent<any>) => {

        const token = (e.currentTarget as HTMLElement).getAttribute("data-column-name");
        const fo = this.props.findOptions;
        const prev = fo.orderOptions.filter(a => a.token.fullKey == token).firstOrNull();

        if (prev != undefined) {
            prev.orderType = prev.orderType == "Ascending" ? "Descending" : "Ascending";
            if (!e.shiftKey)
                fo.orderOptions = [prev];

        } else {

            const column = fo.columnOptions.filter(a => a.token && a.token.fullKey == token).first("Column");

            const newOrder: OrderOptionParsed = { token: column.token!, orderType: "Ascending" };

            if (e.shiftKey)
                fo.orderOptions.push(newOrder);
            else
                fo.orderOptions = [newOrder];
        }


        if (fo.pagination.mode != "All")
            this.doSearchPage1();
    }

    //HEADER DRAG AND DROP

    handleHeaderDragStart = (de: React.DragEvent<any>) => {
        de.dataTransfer.setData('text', "start"); //cannot be empty string
        de.dataTransfer.effectAllowed = "move";
        const dragIndex = parseInt((de.currentTarget as HTMLElement).getAttribute("data-column-index") !);
        this.setState({ dragColumnIndex: dragIndex });
    }

    handleHeaderDragEnd = (de: React.DragEvent<any>) => {
        this.setState({ dragColumnIndex: undefined, dropBorderIndex: undefined });
    }


    getOffset(pageX: number, rect: ClientRect, margin: number) {

        if (margin > rect.width / 2)
            margin = rect.width / 2;

        const width = rect.width;
        const offsetX = pageX - rect.left;

        if (offsetX < margin)
            return 0;

        if (offsetX > (width - margin))
            return 1;

        return undefined;
    }

    handlerHeaderDragOver = (de: React.DragEvent<any>) => {
        de.preventDefault();

        const th = de.currentTarget as HTMLElement;

        const size = th.scrollWidth;

        const columnIndex = parseInt(th.getAttribute("data-column-index") !);

        const offset = this.getOffset((de.nativeEvent as DragEvent).pageX, th.getBoundingClientRect(), 50);

        let dropBorderIndex = offset == undefined ? undefined : columnIndex + offset;

        if (dropBorderIndex == this.state.dragColumnIndex || dropBorderIndex == this.state.dragColumnIndex! + 1)
            dropBorderIndex = undefined;

        //de.dataTransfer.dropEffect = dropBorderIndex == undefined ? "none" : "move";

        if (this.state.dropBorderIndex != dropBorderIndex)
            this.setState({ dropBorderIndex: dropBorderIndex });
    }

    handleHeaderDrop = (de: React.DragEvent<any>) => {

        const columns = this.props.findOptions.columnOptions;
        const dragColumnIndex = this.state.dragColumnIndex!;
        const dropBorderIndex = this.state.dropBorderIndex!;
        const temp = columns[dragColumnIndex!];
        columns.removeAt(dragColumnIndex!);
        const rebasedDropIndex = dropBorderIndex > dragColumnIndex ? dropBorderIndex - 1 : dropBorderIndex;
        columns.insertAt(rebasedDropIndex, temp);

        this.setState({
            dropBorderIndex: undefined,
            dragColumnIndex: undefined
        });
    }

    renderHeaders(): React.ReactNode {

        return (
            <tr>
                {this.props.allowSelection && <th className="sf-th-selection">
                    <input type="checkbox" id="cbSelectAll" onClick={this.handleToggleAll} checked={this.allSelected()} />
                </th>
                }
                {this.props.findOptions.navigate && <th className="sf-th-entity" data-column-name="Entity"></th>}
                {this.props.findOptions.columnOptions.map((co, i) =>
                    <th draggable={true}
                        style={i == this.state.dragColumnIndex ? { opacity: 0.5 } : undefined}
                        className={classes(
                            co == this.state.editingColumn && "sf-current-column",
                            !this.canOrder(co) && "noOrder",
                            co == this.state.editingColumn && co.token && co.token.type.isCollection && "error",
                            this.state.dropBorderIndex != null && i == this.state.dropBorderIndex ? "drag-left " :
                                this.state.dropBorderIndex != null && i == this.state.dropBorderIndex - 1 ? "drag-right " : undefined)}
                        data-column-name={co.token && co.token.fullKey}
                        data-column-index={i}
                        key={i}
                        onClick={this.canOrder(co) ? this.handleHeaderClick : undefined}
                        onDragStart={this.handleHeaderDragStart}
                        onDragEnd={this.handleHeaderDragEnd}
                        onDragOver={this.handlerHeaderDragOver}
                        onDragEnter={this.handlerHeaderDragOver}
                        onDrop={this.handleHeaderDrop}>
                        <span className={"sf-header-sort " + this.orderClassName(co)} />
                        <span> {co.displayName}</span></th>
                )}
            </tr>
        );
    }

    canOrder(column: ColumnOptionParsed) {
        return column.token && !column.token.type.isCollection && !column.token.type.isEmbedded && !isTypeModel(column.token.type.name);
    }

    orderClassName(column: ColumnOptionParsed) {

        if (column.token == undefined)
            return "";

        const orders = this.props.findOptions.orderOptions;

        const o = orders.filter(a => a.token.fullKey == column.token!.fullKey).firstOrNull();
        if (o == undefined)
            return "";


        let asc = (o.orderType == "Ascending" ? "asc" : "desc");

        if (orders.indexOf(o))
            asc += " l" + orders.indexOf(o);

        return asc;
    }

    //ROWS

    handleChecked = (event: React.ChangeEvent<HTMLInputElement>) => {

        const cb = event.currentTarget;

        const index = parseInt(cb.getAttribute("data-index") !);

        const row = this.state.resultTable!.rows[index];

        var selectedRows = this.state.selectedRows!;

        if (cb.checked) {
            if (!selectedRows.contains(row))
                selectedRows.push(row);
        } else {
            selectedRows.remove(row);
        }
        
        this.notifySelectedRowsChanged();

        this.setState({ currentMenuItems: undefined });
    }

    handleDoubleClick = (e: React.MouseEvent<any>, row: ResultRow) => {

        if ((e.target as HTMLElement).parentElement != e.currentTarget) //directly in the td
            return;

        if (this.props.onDoubleClick) {
            e.preventDefault();
            this.props.onDoubleClick(e, row);
            return;
        }

        var qs = this.props.querySettings;
        if (qs && qs.onDoubleClick) {
            e.preventDefault();
            qs.onDoubleClick(e, row);
            return;
        }

        if (!Navigator.isNavigable(row.entity.EntityType))
            return;

        e.preventDefault();

        const s = Navigator.getSettings(row.entity.EntityType)

        const avoidPopup = s != undefined && s.avoidPopup;

        if (avoidPopup || e.ctrlKey || e.button == 1) {
            window.open(Navigator.navigateRoute(row.entity));
        }
        else {
            Navigator.navigate(row.entity).done();
        }

    }

    renderRows(): React.ReactNode {

        const columnsCount = this.props.findOptions.columnOptions.length +
            (this.props.allowSelection ? 1 : 0) +
            (this.props.findOptions.navigate ? 1 : 0);


        if (!this.state.resultTable) {
            return <tr><td colSpan={columnsCount}>{JavascriptMessage.searchForResults.niceToString()}</td></tr>;
        }

        var resultTable = this.state.resultTable;

        if (resultTable.rows.length == 0) {
            return <tr><td colSpan={columnsCount}>{SearchMessage.NoResultsFound.niceToString()}</td></tr>;
        }

        const qs = this.props.querySettings;

        const columns = this.props.findOptions.columnOptions.map(co => ({
            columnOption: co,
            cellFormatter: (co.token && this.props.formatters && this.props.formatters[co.token.fullKey]) || Finder.getCellFormatter(qs, co),
            resultIndex: co.token == undefined ? -1 : resultTable.columns.indexOf(co.token.fullKey)
        }));

        const ctx: Finder.CellFormatterContext = {
            refresh: () => this.doSearch().done()
        };

        const rowAttributes = this.props.rowAttributes || qs && qs.rowAttributes;

        return this.state.resultTable.rows.map((row, i) => {

            const mark = this.getMarkedRow(row.entity);

            var ra = rowAttributes ? rowAttributes(row, resultTable.columns) : undefined;

            const tr = (
                <tr key={i} data-row-index={i} data-entity={liteKey(row.entity)} onDoubleClick={e => this.handleDoubleClick(e, row)}
                    {...ra}
                    className={classes(mark && mark.className, ra && ra.className)}>
                    {this.props.allowSelection &&
                        <td style={{ textAlign: "center" }}>
                            <input type="checkbox" className="sf-td-selection" checked={this.state.selectedRows!.contains(row)} onChange={this.handleChecked} data-index={i} />
                        </td>
                    }

                    {this.props.findOptions.navigate &&
                        <td>
                            {(this.props.entityFormatter || (qs && qs.entityFormatter) || Finder.entityFormatRules.filter(a => a.isApplicable(row)).last("EntityFormatRules").formatter)(row, resultTable.columns, this)}
                        </td>
                    }

                    {columns.map((c, j) =>
                        <td key={j} data-column-index={j} className={c.cellFormatter && c.cellFormatter.cellClass}>
                            {c.resultIndex == -1 || c.cellFormatter == undefined ? undefined : c.cellFormatter.formatter(row.columns[c.resultIndex], ctx)}
                        </td>)}
                </tr>
            );

            return this.wrapError(mark, i, tr);
        });
    }

    handleOnNavigated = (lite: Lite<Entity>) => {
        if (this.props.avoidAutoRefresh)
            return;

        this.doSearch();
    }

    getMarkedRow(entity: Lite<Entity>): MarkedRow | undefined {

        if (!entity || !this.state.markedRows)
            return undefined;

        const m = this.state.markedRows[liteKey(entity)];

        if (typeof m === "string") {
            if (m == "")
                return { className: "sf-entity-ctxmenu-success", message: undefined };
            else
                return { className: "danger", message: m };
        }
        else {
            return m;
        }
    }

    wrapError(mark: MarkedRow | undefined, index: number, tr: React.ReactChild | undefined) {
        if (!mark || !mark.message)
            return tr;

        const tooltip = <Tooltip id={"mark_" + index} className="error-tooltip">
            {mark.message.split("\n").map((s, i) => <p key={i}>{s}</p>)}
        </Tooltip>;

        return <OverlayTrigger placement="bottom" overlay={tooltip}>{tr}</OverlayTrigger>;
    }

}

function withoutAllAny(qt: QueryToken | undefined): QueryToken | undefined {
    if (qt == undefined)
        return undefined;

    if (qt.queryTokenType == "AnyOrAll")
        return withoutAllAny(qt.parent);

    var par = withoutAllAny(qt.parent);

    if (par == qt.parent)
        return qt; 

    return par; 
}