import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  Text,
  EmptyState,
  Spinner,
  Filters,
  Select,
  Button,
  Pagination,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { useQuery } from "react-query";

export default function ProductsPage() {
  const [searchValue, setSearchValue] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  // Fetch products data
  const {
    data: productsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      "products",
      searchValue,
      vendorFilter,
      statusFilter,
      currentPage,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: currentPage,
        limit: itemsPerPage,
        ...(searchValue && { search: searchValue }),
        ...(vendorFilter && { vendor: vendorFilter }),
        ...(statusFilter && { status: statusFilter }),
      });

      const response = await fetch(`/api/products?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch products");
      }
      return await response.json();
    },
    refetchOnWindowFocus: false,
    keepPreviousData: true,
  });

  // Fetch vendors for filter dropdown
  const { data: vendorsData } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const response = await fetch("/api/vendor/list");
      return await response.json();
    },
    refetchOnWindowFocus: false,
  });

  const handleSearchChange = useCallback((value) => {
    setSearchValue(value);
    setCurrentPage(1);
  }, []);

  const handleVendorFilterChange = useCallback((value) => {
    setVendorFilter(value);
    setCurrentPage(1);
  }, []);

  const handleStatusFilterChange = useCallback((value) => {
    setStatusFilter(value);
    setCurrentPage(1);
  }, []);

  const handleFiltersRemove = useCallback(() => {
    setSearchValue("");
    setVendorFilter("");
    setStatusFilter("");
    setCurrentPage(1);
  }, []);

  const getStatusBadge = (status) => {
    const statusMap = {
      active: { status: "success", children: "Active" },
      draft: { status: "warning", children: "Draft" },
      archived: { status: "critical", children: "Archived" },
      deleted: { status: "critical", children: "Deleted" },
    };
    return <Badge {...(statusMap[status] || { children: status })} />;
  };

  // Prepare table data
  const tableData =
    productsData?.products?.map((product) => [
      <Text variant="bodyMd" fontWeight="semibold">
        {product.name}
      </Text>,
      product.sku || "—",
      product.vendorName || "—",
      getStatusBadge(product.status),
      product.inventoryQuantity?.toString() || "0",
      product.price ? `$${parseFloat(product.price).toFixed(2)}` : "—",
      new Date(product.shopifyCreatedAt).toLocaleDateString(),
    ]) || [];

  const tableHeaders = [
    "Product Name",
    "SKU",
    "Vendor",
    "Status",
    "Inventory",
    "Price",
    "Created",
  ];

  // Filter options
  const vendorOptions = [
    { label: "All vendors", value: "" },
    ...(vendorsData?.vendors?.map((vendor) => ({
      label: vendor.name,
      value: vendor.shopifyVendorName || vendor.name,
    })) || []),
  ];

  const statusOptions = [
    { label: "All statuses", value: "" },
    { label: "Active", value: "active" },
    { label: "Draft", value: "draft" },
    { label: "Archived", value: "archived" },
  ];

  const appliedFilters = [];
  if (searchValue)
    appliedFilters.push({
      key: "search",
      label: `Search: ${searchValue}`,
      onRemove: () => setSearchValue(""),
    });
  if (vendorFilter)
    appliedFilters.push({
      key: "vendor",
      label: `Vendor: ${vendorFilter}`,
      onRemove: () => setVendorFilter(""),
    });
  if (statusFilter)
    appliedFilters.push({
      key: "status",
      label: `Status: ${statusFilter}`,
      onRemove: () => setStatusFilter(""),
    });

  const filters = (
    <Filters
      queryValue={searchValue}
      filters={[
        {
          key: "vendor",
          label: "Vendor",
          filter: (
            <Select
              label="Vendor"
              labelHidden
              options={vendorOptions}
              value={vendorFilter}
              onChange={handleVendorFilterChange}
            />
          ),
        },
        {
          key: "status",
          label: "Status",
          filter: (
            <Select
              label="Status"
              labelHidden
              options={statusOptions}
              value={statusFilter}
              onChange={handleStatusFilterChange}
            />
          ),
        },
      ]}
      appliedFilters={appliedFilters}
      onQueryChange={handleSearchChange}
      onQueryClear={() => setSearchValue("")}
      onClearAll={handleFiltersRemove}
    />
  );

  if (error) {
    return (
      <Page narrowWidth>
        <TitleBar title="Products" />
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Error loading products"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>There was an error loading the products data.</p>
                <Button onClick={() => refetch()}>Try again</Button>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Products">
        <button variant="primary" onClick={() => refetch()}>
          Refresh
        </button>
      </TitleBar>
      <Layout>
        <Layout.Section>
          <Card>
            <div style={{ marginBottom: "1rem" }}>{filters}</div>

            {isLoading ? (
              <div style={{ textAlign: "center", padding: "2rem" }}>
                <Spinner size="large" />
              </div>
            ) : tableData.length === 0 ? (
              <EmptyState
                heading="No products found"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Try adjusting your search or filter criteria.</p>
              </EmptyState>
            ) : (
              <>
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "text",
                    "text",
                    "numeric",
                    "numeric",
                    "text",
                  ]}
                  headings={tableHeaders}
                  rows={tableData}
                  hoverable
                />

                {productsData?.pagination && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: "1rem",
                      padding: "1rem 0",
                    }}
                  >
                    <Text variant="bodySm" tone="subdued">
                      Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
                      {Math.min(
                        currentPage * itemsPerPage,
                        productsData.pagination.total
                      )}{" "}
                      of {productsData.pagination.total} products
                    </Text>

                    <Pagination
                      hasPrevious={currentPage > 1}
                      onPrevious={() => setCurrentPage(currentPage - 1)}
                      hasNext={currentPage < productsData.pagination.totalPages}
                      onNext={() => setCurrentPage(currentPage + 1)}
                    />
                  </div>
                )}
              </>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
