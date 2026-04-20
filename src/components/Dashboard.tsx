import { OnboardTab } from './tabs/OnboardTab'
import { OverviewTab } from './tabs/OverviewTab'
import { EnrichmentTab } from './tabs/EnrichmentTab'
import { IntelligenceTab } from './tabs/IntelligenceTab'
import { DnaStrandTab } from './tabs/DnaStrandTab'
import { ExportTab } from './tabs/ExportTab'
import { HistoryTab } from './tabs/HistoryTab'

interface DashboardProps {
  activeTab: string
}

export function Dashboard({ activeTab }: DashboardProps) {
  switch (activeTab) {
    case 'Onboard':
      return <OnboardTab />
    case 'Overview':
      return <OverviewTab />
    case 'Enrichment':
      return <EnrichmentTab />
    case 'Intelligence':
      return <IntelligenceTab />
    case 'DNA Strand':
      return <DnaStrandTab />
    case 'Export':
      return <ExportTab />
    case 'History':
      return <HistoryTab />
    default:
      return <OverviewTab />
  }
}
