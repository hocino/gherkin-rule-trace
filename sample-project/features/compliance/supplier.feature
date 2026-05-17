Feature: Supplier compliance

  Rule: #010 A vigilance certificate must be valid

    Scenario: Reject expired certificate
      Given a supplier has an expired vigilance certificate
      When the compliance check runs
      Then the supplier should be marked as non-compliant

  Rule: #011 A subcontractor must provide required documents

    Scenario: Reject missing subcontractor documents
      Given a subcontractor has missing required documents
      When the compliance check runs
      Then the subcontractor should be marked as non-compliant
