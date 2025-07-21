import {
  Page,
  Layout,
  Card,
  TextContainer,
  BlockStack,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";

export default function HomePage() {
  const { t } = useTranslation();

  const { data, isLoading: isLoadingVendors } = useQuery({
    queryKey: ["GetVendors"],
    queryFn: async () => {
      const response = await fetch("/api/vendor/list");
      return await response.json();
    },
    refetchOnWindowFocus: false,
  });

  return (
    <Page narrowWidth>
      <TitleBar title={"Vendor List"} />
      <Layout>
        <Layout.Section>
          <Card sectioned>
            <TextContainer spacing="loose">
              <p>{t("ProductsCard.description")}</p>
              <Text as="h4" variant="headingMd">
                <Text variant="bodyMd" as="p" fontWeight="semibold">
                  {isLoadingVendors ? (
                    "-"
                  ) : (
                    <BlockStack gap="200">
                      {data?.vendors.map((v, i) => (
                        <Text as="p" variant="bodyMd" tone="subdued">
                          <strong>{ i + 1 }.</strong> { v }
                        </Text>
                      ))}
                    </BlockStack>
                  )}
                </Text>
              </Text>
            </TextContainer>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
