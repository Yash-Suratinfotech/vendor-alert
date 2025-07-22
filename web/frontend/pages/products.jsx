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
  Frame,
  InlineStack,
  BlockStack,
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
      active: { tone: "success", children: "Active" },
      draft: { tone: "warning", children: "Draft" },
      archived: { tone: "critical", children: "Archived" },
      deleted: { tone: "critical", children: "Deleted" },
    };
    return <Badge {...(statusMap[status] || { children: status })} />;
  };

  const getInventoryBadge = (quantity) => {
    const qty = parseInt(quantity) || 0;
    if (qty === 0) {
      return <Badge tone="critical">Out of Stock</Badge>;
    } else if (qty < 10) {
      return <Badge tone="warning">Low Stock ({qty})</Badge>;
    } else {
      return <Badge tone="success">{qty} in stock</Badge>;
    }
  };

  // Prepare table data
  const tableData =
    productsData?.products?.map((product) => [
      <div>
        <Text variant="bodyMd" fontWeight="semibold">
          {product.name}
        </Text>
        {product.handle && (
          <Text variant="bodySm" tone="subdued">
            Handle: {product.handle}
          </Text>
        )}
      </div>,
      product.sku || "—",
      <Text variant="bodyMd" fontWeight="medium">
        {product.vendorName || "—"}
      </Text>,
      getStatusBadge(product.status),
      <div style={{ textAlign: "right" }}>
        {getInventoryBadge(product.inventoryQuantity)}
      </div>,
      <div style={{ textAlign: "right" }}>
        <Text variant="bodyMd" fontWeight="medium">
          {product.price ? `$${parseFloat(product.price).toFixed(2)}` : "—"}
        </Text>
        {product.productType && (
          <Text variant="bodySm" tone="subdued">
            {product.productType}
          </Text>
        )}
      </div>,
      new Date(
        product.shopifyCreatedAt || product.createdAt
      ).toLocaleDateString(),
    ]) || [];

  const tableHeaders = [
    "Product",
    "SKU",
    "Vendor",
    "Status",
    "Inventory",
    "Price & Type",
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
      queryPlaceholder="Search products..."
    />
  );

  if (error) {
    return (
      <Frame>
        <Page fullWidth>
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
      </Frame>
    );
  }

  return (
    <Frame>
      <Page fullWidth>
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
                  <Text variant="bodyMd" tone="subdued">
                    Loading products...
                  </Text>
                </div>
              ) : tableData.length === 0 ? (
                <EmptyState
                  heading="No products found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    {appliedFilters.length > 0
                      ? "Try adjusting your search or filter criteria."
                      : "No products have been synced yet. Products will appear automatically when they are synced from your store."}
                  </p>
                  <InlineStack gap="300">
                    {appliedFilters.length > 0 && (
                      <Button onClick={handleFiltersRemove}>
                        Clear Filters
                      </Button>
                    )}
                    <Button
                      primary
                      onClick={() => (window.location.href = "/debug")}
                    >
                      Sync Data
                    </Button>
                  </InlineStack>
                </EmptyState>
              ) : (
                <>
                  <DataTable
                    columnContentTypes={[
                      "text",
                      "text",
                      "text",
                      "text",
                      "text",
                      "text",
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
                        hasNext={
                          currentPage < productsData.pagination.totalPages
                        }
                        onNext={() => setCurrentPage(currentPage + 1)}
                      />
                    </div>
                  )}
                </>
              )}
            </Card>
          </Layout.Section>

          {/* Product Stats Summary */}
          {productsData?.products && productsData.products.length > 0 && (
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd">Product Summary</Text>

                  <div>
                    <Text variant="headingLg" as="h3">
                      {productsData.pagination?.total ||
                        productsData.products.length}
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      Total Products
                    </Text>
                  </div>

                  <div>
                    <Text variant="headingLg" as="h3">
                      {
                        productsData.products.filter(
                          (p) => p.status === "active"
                        ).length
                      }
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      Active Products
                    </Text>
                  </div>

                  <div>
                    <Text variant="headingLg" as="h3">
                      {
                        productsData.products.filter(
                          (p) => parseInt(p.inventoryQuantity || 0) === 0
                        ).length
                      }
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      Out of Stock
                    </Text>
                  </div>

                  <div>
                    <Text variant="headingLg" as="h3">
                      {
                        productsData.products.filter(
                          (p) =>
                            parseInt(p.inventoryQuantity || 0) > 0 &&
                            parseInt(p.inventoryQuantity || 0) < 10
                        ).length
                      }
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      Low Stock (&lt;10)
                    </Text>
                  </div>

                  <div>
                    <Text variant="headingLg" as="h3">
                      {
                        new Set(
                          productsData.products
                            .map((p) => p.vendorName)
                            .filter(Boolean)
                        ).size
                      }
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      Unique Vendors
                    </Text>
                  </div>

                  <div>
                    <Text variant="headingLg" as="h3">
                      $
                      {productsData.products
                        .reduce(
                          (sum, product) =>
                            sum + parseFloat(product.price || 0),
                          0
                        )
                        .toFixed(2)}
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      Total Catalog Value
                    </Text>
                  </div>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>
      </Page>
    </Frame>
  );
}
