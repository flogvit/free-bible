import React, { useState } from 'react';
import styled from 'styled-components';
import DOMPurify from 'dompurify';

const SummaryWrapper = styled.div`
  margin: 20px 0;
`;

const SummaryDetail = styled.div`
  background: lightgrey;
  margin-top: 10px;
  padding: 10px;
`;

const SummaryTitle = styled.h2`
  cursor: pointer;
  /* Additional styling for the title */
`;

const ChapterSummary = ({ summary }) => {
    const [showDetail, setShowDetail] = useState(false);

    const toggleDetail = () => setShowDetail(!showDetail);

    // Sanitize the HTML content
    const sanitizedContent = DOMPurify.sanitize(summary.text);

    return (
        <SummaryWrapper>
            <SummaryTitle onClick={toggleDetail}>Kapittel {summary.chapterId}</SummaryTitle>
            {showDetail && (
                <SummaryDetail dangerouslySetInnerHTML={{ __html: sanitizedContent }} />
            )}
        </SummaryWrapper>
    );
};

export default ChapterSummary;
