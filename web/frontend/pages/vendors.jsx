import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  Text,
  InlineStack,
  BlockStack,
  EmptyState,
  Spinner,
  Filters,
  Button,
  Pagination,
  Modal,
  TextField,
  FormLayout,
  Toast,
  Frame,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "react-query";

export default function VendorsPage() {
  const [searchValue, setSearchValue] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editFormData, setEditFormData] = useState({
    name: "",
    contactPerson: "",
    mobile: "",
    email: "",
    upiId: "",
  });
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const itemsPerPage = 25;
  const queryClient = useQueryClient();

  // Fetch vendors data
  const {
    data: vendorsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["vendors", searchValue, currentPage],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: currentPage,
        limit: itemsPerPage,
        ...(searchValue && { search: searchValue }),
      });

      const response = await fetch(`/api/vendor/list?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch vendors");
      }
      return await response.json();
    },
    refetchOnWindowFocus: false,
    keepPreviousData: true,
  });

  // Update vendor mutation
  const updateVendorMutation = useMutation({
    mutationFn: async (vendorData) => {
      const response = await fetch(`/api/vendor/${vendorData.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(vendorData),
      });

      if (!response.ok) {
        throw new Error("Failed to update vendor");
      }
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["vendors"]);
      setIsEditModalOpen(false);
      setSelectedVendor(null);
      setToastMessage("Vendor updated successfully");
      setShowToast(true);
    },
    onError: (error) => {
      setToastMessage(`Error: ${error.message}`);
      setShowToast(true);
    },
  });

  const handleSearchChange = useCallback((value) => {
    setSearchValue(value);
    setCurrentPage(1);
  }, []);

  const handleFiltersRemove = useCallback(() => {
    setSearchValue("");
    setCurrentPage(1);
  }, []);

  const handleEditVendor = useCallback((vendor) => {
    setSelectedVendor(vendor);
    setEditFormData({
      name: vendor.name || "",
      contactPerson: vendor.contactPerson || "",
      mobile: vendor.mobile || "",
      email: vendor.email || "",
      upiId: vendor.upiId || "",
    });
    setIsEditModalOpen(true);
  }, []);

  const handleFormChange = useCallback((field, value) => {
    setEditFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const handleSaveVendor = useCallback(() => {
    if (!selectedVendor) return;

    updateVendorMutation.mutate({
      ...selectedVendor,
      ...editFormData,
    });
  }, [selectedVendor, editFormData, updateVendorMutation]);

  const getVendorStats = (vendor) => {
    return {
      products: vendor.stats.productCount || 0,
      orders: vendor.stats.orderCount || 0,
    };
  };

  // Prepare table data
  const tableData =
    vendorsData?.vendors?.map((vendor) => {
      const stats = getVendorStats(vendor);
      return [
        <Text variant="bodyMd" fontWeight="semibold">
          {vendor.name}
        </Text>,
        vendor.contactPerson || "—",
        vendor.mobile || "—",
        vendor.email || "—",
        vendor.upiId || "—",
        <InlineStack gap="200">
          <Badge tone="info">{stats.products} products</Badge>
          <Badge tone="success">{stats.orders} orders</Badge>
        </InlineStack>,
        <Button size="slim" onClick={() => handleEditVendor(vendor)}>
          Edit
        </Button>,
      ];
    }) || [];

  const tableHeaders = [
    "Vendor Name",
    "Contact Person",
    "Mobile",
    "Email",
    "UPI ID",
    "Stats",
    "Actions",
  ];

  const appliedFilters = [];
  if (searchValue)
    appliedFilters.push({
      key: "search",
      label: `Search: ${searchValue}`,
      onRemove: () => setSearchValue(""),
    });

  const filters = (
    <Filters
      queryValue={searchValue}
      filters={[]}
      appliedFilters={appliedFilters}
      onQueryChange={handleSearchChange}
      onQueryClear={() => setSearchValue("")}
      onClearAll={handleFiltersRemove}
      queryPlaceholder="Search vendors..."
    />
  );

  const toastMarkup = showToast ? (
    <Toast content={toastMessage} onDismiss={() => setShowToast(false)} />
  ) : null;

  if (error) {
    return (
      <Frame>
        <Page fullWidth>
          <TitleBar title="Vendors" />
          <Layout>
            <Layout.Section>
              <Card>
                <EmptyState
                  heading="Error loading vendors"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>There was an error loading the vendors data.</p>
                  <Button onClick={() => refetch()}>Try again</Button>
                </EmptyState>
              </Card>
            </Layout.Section>
          </Layout>
        </Page>
        {toastMarkup}
      </Frame>
    );
  }

  return (
    <Frame>
      <Page fullWidth>
        <TitleBar title="Vendors">
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
                  heading="No vendors found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    {searchValue
                      ? "Try adjusting your search criteria."
                      : "Vendors will appear automatically when products are synced from your store."}
                  </p>
                  {!searchValue && (
                    <Button
                      primary
                      onClick={() => (window.location.href = "/debug")}
                    >
                      Sync Data
                    </Button>
                  )}
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
                      "text",
                    ]}
                    headings={tableHeaders}
                    rows={tableData}
                    hoverable
                  />

                  {vendorsData?.pagination && (
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
                          vendorsData.pagination.total
                        )}{" "}
                        of {vendorsData.pagination.total} vendors
                      </Text>

                      <Pagination
                        hasPrevious={currentPage > 1}
                        onPrevious={() => setCurrentPage(currentPage - 1)}
                        hasNext={
                          currentPage < vendorsData.pagination.totalPages
                        }
                        onNext={() => setCurrentPage(currentPage + 1)}
                      />
                    </div>
                  )}
                </>
              )}
            </Card>
          </Layout.Section>
        </Layout>

        {/* Edit Vendor Modal */}
        <Modal
          open={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setSelectedVendor(null);
          }}
          title={`Edit Vendor: ${selectedVendor?.name}`}
          primaryAction={{
            content: "Save Changes",
            onAction: handleSaveVendor,
            loading: updateVendorMutation.isLoading,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => {
                setIsEditModalOpen(false);
                setSelectedVendor(null);
              },
            },
          ]}
        >
          <Modal.Section>
            <FormLayout>
              <TextField
                label="Vendor Name"
                value={editFormData.name}
                onChange={(value) => handleFormChange("name", value)}
                autoComplete="organization"
                readOnly
              />

              <TextField
                label="Contact Person"
                value={editFormData.contactPerson}
                onChange={(value) => handleFormChange("contactPerson", value)}
                autoComplete="name"
              />

              <TextField
                label="Mobile Number"
                value={editFormData.mobile}
                onChange={(value) => handleFormChange("mobile", value)}
                type="tel"
                autoComplete="tel"
              />

              <TextField
                label="Email Address"
                value={editFormData.email}
                onChange={(value) => handleFormChange("email", value)}
                type="email"
                autoComplete="email"
              />

              <TextField
                label="UPI ID"
                value={editFormData.upiId}
                onChange={(value) => handleFormChange("upiId", value)}
                helpText="For payment notifications"
              />
            </FormLayout>
          </Modal.Section>
        </Modal>
      </Page>
      {toastMarkup}
    </Frame>
  );
}
